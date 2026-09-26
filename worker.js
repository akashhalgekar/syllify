/**
 * Syllify AI endpoint — one Cloudflare Worker, any model you like.
 *
 * The Syllify page posts { prompt } here. This forwards it to whichever provider
 * you configure, with YOUR key, and returns the reply. The key never reaches the
 * browser, and the page verifies every row of the reply against the student's own
 * document before showing it.
 *
 * ── SETUP (about five minutes, no command line) ────────────────────────────────
 *  1. dash.cloudflare.com → Workers & Pages → Create → Worker
 *  2. Name it "syllify-ai" → Deploy → Edit code
 *  3. Delete the sample, paste this whole file, Deploy
 *  4. Settings → Variables and Secrets. Add ONE provider's key as a Secret:
 *
 *       PROVIDER = anthropic     (plain text)   ANTHROPIC_API_KEY = sk-ant-...
 *       PROVIDER = openai        (plain text)   OPENAI_API_KEY    = sk-...
 *       PROVIDER = gemini        (plain text)   GEMINI_API_KEY    = ...
 *       PROVIDER = groq          (plain text)   GROQ_API_KEY      = gsk_...
 *       PROVIDER = openrouter    (plain text)   OPENROUTER_API_KEY= sk-or-...
 *
 *     Optional plain-text variables:
 *       MODEL           override the default model for that provider
 *       ALLOWED_ORIGIN  https://your-site.netlify.app  (leave unset while testing)
 *       BASE_URL        for any OpenAI-compatible endpoint you host yourself
 *
 *  5. Copy the Worker URL, e.g. https://syllify-ai.yourname.workers.dev
 *  6. In index.html set:  const AI_ENDPOINT = "https://syllify-ai.yourname.workers.dev";
 *     Redeploy the site. The AI pass now runs automatically for every student.
 *
 * ── COST ───────────────────────────────────────────────────────────────────────
 *  Roughly 500 tokens in and a few hundred out per syllabus. On a cheap tier that is
 *  a small fraction of a cent; a class of 100 is well under a dollar for the term.
 *  Groq and Gemini both have free tiers that will cover a pilot — but read their
 *  terms on training data before sending student coursework through them.
 *
 * ── LIMITS ENFORCED HERE ───────────────────────────────────────────────────────
 *  POST and JSON only, 60 KB prompt cap, at most 3 images totalling 6 MB, one
 *  allowed origin, 20 requests per minute per IP. Turn on Cloudflare's own Rate Limiting rules too if the URL
 *  ever leaks.
 */

const MAX_PROMPT_BYTES = 60_000;
const MAX_IMAGE_BYTES = 6_000_000;   // a couple of rendered pages
const MAX_IMAGES = 3;
const MAX_PER_MINUTE = 20;
/* A syllabus yields tens of rows, not hundreds. 4096 was headroom nobody used and
   output tokens are the expensive half of the bill. */
const MAX_TOKENS = 1600;

const DEFAULT_MODEL = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
  groq: "llama-3.3-70b-versatile",
  openrouter: "anthropic/claude-3.5-haiku",
};

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const bucket = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  bucket.push(now);
  hits.set(ip, bucket);
  if (hits.size > 5000) hits.clear();
  return bucket.length > MAX_PER_MINUTE;
}

function cors(env, extra = {}) {
  return {
    "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    ...extra,
  };
}
const json = (env, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors(env, { "content-type": "application/json" }) });

/** Each provider: where to post, what headers, what body, how to read the text back. */
/* data:image/jpeg;base64,xxxx  ->  { media, b64 } */
function splitDataUrl(u) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(u || ""));
  return m ? { media: m[1], b64: m[2] } : null;
}

function buildCall(provider, key, model, prompt, env, images) {
  if (provider === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: {
        model, max_tokens: MAX_TOKENS, temperature: 0,
        messages: [{
          role: "user",
          content: images.length
            ? [...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.media, data: i.b64 } })),
               { type: "text", text: prompt }]
            : prompt,
        }],
      },
      read: (d) => (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join(""),
    };
  }
  if (provider === "gemini") {
    return {
      url:
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(model) +
        ":generateContent?key=" +
        encodeURIComponent(key),
      headers: { "content-type": "application/json" },
      body: {
        contents: [{ parts: [
          ...images.map((i) => ({ inline_data: { mime_type: i.media, data: i.b64 } })),
          { text: prompt },
        ] }],
        generationConfig: { temperature: 0, maxOutputTokens: MAX_TOKENS },
      },
      read: (d) =>
        ((d.candidates || [])[0]?.content?.parts || []).map((p) => p.text || "").join(""),
    };
  }
  // openai, groq, openrouter and anything else that speaks the OpenAI shape
  const base =
    env.BASE_URL ||
    (provider === "groq"
      ? "https://api.groq.com/openai/v1"
      : provider === "openrouter"
      ? "https://openrouter.ai/api/v1"
      : "https://api.openai.com/v1");
  return {
    url: base.replace(/\/$/, "") + "/chat/completions",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: {
      model, temperature: 0, max_tokens: MAX_TOKENS,
      messages: [{
        role: "user",
        content: images.length
          ? [...images.map((i) => ({ type: "image_url", image_url: { url: "data:" + i.media + ";base64," + i.b64 } })),
             { type: "text", text: prompt }]
          : prompt,
      }],
    },
    read: (d) => ((d.choices || [])[0]?.message?.content) || "",
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
    if (request.method !== "POST")
      return new Response("POST a JSON body: { prompt }", {
        status: 405,
        headers: cors(env, { "content-type": "text/plain" }),
      });

    if (env.ALLOWED_ORIGIN) {
      const origin = request.headers.get("origin") || "";
      if (origin && origin !== env.ALLOWED_ORIGIN) return json(env, { error: "origin not allowed" }, 403);
    }
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (rateLimited(ip)) return json(env, { error: "slow down" }, 429);

    let prompt, rawImages;
    try {
      ({ prompt, images: rawImages } = await request.json());
    } catch {
      return json(env, { error: "body must be JSON" }, 400);
    }

    /* Images are only sent when a syllabus schedule turned out to be a picture. */
    const images = [];
    if (Array.isArray(rawImages)) {
      if (rawImages.length > MAX_IMAGES) return json(env, { error: "too many images" }, 413);
      let bytes = 0;
      for (const u of rawImages) {
        const img = splitDataUrl(u);
        if (!img) return json(env, { error: "images must be base64 data URLs" }, 400);
        bytes += img.b64.length * 0.75;
        if (bytes > MAX_IMAGE_BYTES) return json(env, { error: "images too large" }, 413);
        images.push(img);
      }
    }
    if (typeof prompt !== "string" || !prompt.trim()) return json(env, { error: "prompt required" }, 400);
    if (new TextEncoder().encode(prompt).length > MAX_PROMPT_BYTES)
      return json(env, { error: "prompt too large" }, 413);

    const provider = (env.PROVIDER || "anthropic").toLowerCase();
    const key =
      env.ANTHROPIC_API_KEY ||
      env.OPENAI_API_KEY ||
      env.GEMINI_API_KEY ||
      env.GROQ_API_KEY ||
      env.OPENROUTER_API_KEY ||
      env.API_KEY;
    if (!key) return json(env, { error: "no API key set on the Worker" }, 500);

    const model = env.MODEL || DEFAULT_MODEL[provider] || DEFAULT_MODEL.anthropic;
    const call = buildCall(provider, key, model, prompt, env, images);

    let upstream;
    try {
      upstream = await fetch(call.url, {
        method: "POST",
        headers: call.headers,
        body: JSON.stringify(call.body),
      });
    } catch {
      return json(env, { error: "upstream unreachable" }, 502);
    }
    if (!upstream.ok) {
      const detail = await upstream.text();
      return json(
        env,
        { error: "upstream " + upstream.status, detail: detail.slice(0, 300) },
        upstream.status === 429 ? 429 : 502,
      );
    }

    let text = "";
    try {
      text = call.read(await upstream.json()) || "";
    } catch {
      return json(env, { error: "could not read the provider reply" }, 502);
    }

    // The page pulls the JSON array out of this text and checks every row against
    // the student's own document before anything is displayed.
    return json(env, { text, provider, model });
  },
};
