/**
 * Syllify parser — deterministic syllabus extraction, no dependencies, no network.
 *
 * Generated from the shipped page so the website, the MCP server and the tests
 * all run the SAME code. Do not edit by hand; edit index.html and rebuild.
 *
 *   import { prepLines, parse, verifyProposals } from "./parser.mjs";
 *
 *   const doc = parse(prepLines(text.split("\n")), { name: "ISE588.pdf", fid: "a" });
 *   doc.items  // dated deliverables, each with .line and .ln pointing at the source
 *   doc.gaps   // recognised but undated
 *   doc.likely // false when the file does not look like a syllabus
 */

const MON={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
  ene:0,abr:3,dic:11,                  // Spanish
  fev:1,avr:3,mai:4,juin:5,juil:6,     // French
  mrz:2,okt:9,dez:11,                  // German
  ott:9,giu:5};                        // Italian
// Non-English names are included only where they cannot collide with ordinary English words.
// "out" (outubro), "set" (setembro), "ago" (agosto), "mag" (maggio) are deliberately excluded.
const MONWORD="jan|feb|f\u00e9v|fev|mar|m\u00e4r|mrz|apr|abr|avr|may|mai|jun|juin|giu|jul|juil|aug|ao\u00fbt|sep|sept|oct|okt|ott|nov|dec|dez|dic|ene";
const RE_MON=new RegExp("\\b("+MONWORD+")[a-z\u00e9\u00fc\u00e4]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(20\\d{2}))?","i");
// "4 March", "21st October 2025" — the day-first written form
const RE_DMY=new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?("+MONWORD+")[a-z\u00e9\u00fc\u00e4]*\\.?,?(?:\\s*(20\\d{2}))?\\b","i");
const RE_NUM=/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?\b/;
const RE_ISO=/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/;
const RE_DOT=/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/;
const RE_WEEK=/\bweek\s*#?\s*(\d{1,2})\b/i;
const RE_TIME=/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i;
const RE_COURSE=/\b([A-Za-z]{2,5})[ \-]?(\d{3,4}[A-Z]?)\b/g;
const RE_COURSE_DOT=/\b(\d{1,2}\.\d{2,3}[A-Z]?)\b/;
const RE_TERM=/\b(fall|autumn|spring|summer|winter)\s+(20\d{2})\b/i;
const RE_TERM2=/\b(semester|term|trimester|quarter)\s*([1-5])\b[\s,]*(20\d{2})?/i;
const RE_YEAR=/\b(20\d{2})\b/;
const RESCHED=/\b(now due|rescheduled|moved to|extended to|postponed)\b/i;
const RE_WKDAY=/\b(mon|tues?|wed(nes)?|thur?s?|fri)(day)?s?\b/i;

const DUE=/\b(due|deadline|submit|submitted|turn in|hand in|deliverable|by midnight|no later than)\b/i;
const EXAM=/\b(exam(?:s|ination|inations)?|midterms?|final\s+exam|quiz|quizzes|tests?|proctored|viva)\b/i;
const READ=/\b(read|reading|readings|chapter|chapters|ch\.?\s*\d|pp\.?\s*\d|pages|textbook|article|case study|case packet|packet)\b/i;
const WORK=/\b(assignment|homework|hw\s*\d|problem set|pset|project|memo|paper|essay|report|presentation|deck|lab|milestone|draft|proposal|portfolio|charter|reflection|submission|round \d|coursework|exercise|dissertation|thesis|worksheet|critique|annotated bibliography|response paper|peer (review|evaluation))s?\b/i;
const NOISE=/^(course\s+(description|descriptions|polic\w+|objectives?|outcomes?|outline|information|info|materials|requirements|staff|website|number|title|overview|goals?)|instructor|office hours|grading|required texts?|description|prerequisite|policy|policies|schedule|syllabus|university|department|contact|email|phone|week \d+\s*\|?\s*$)/i;
const NEG=/\bno (reading|readings|class|assignment|homework|meeting)\b/i;
const CITE=/^[A-Z][A-Za-z'’-]+,\s+[A-Z]\.\s/;
const CODEISH=/^(?!(week|wk|lec|lecture|session|ses|ch|chap|chapter|page|pp|fig|day|unit|module|topic|no|part|vol)\b)[a-z]{1,4}[-–—_ ]?\d{1,3}[a-z]?$/i;
const GAPVERB=/\b(due|submit|submitted|required|expected|collected|complete|completed|turn in|hand in|attend|attendance|present|presented|presents?|deliver|delivers|delivered|determine)\b/i;
const GAPVERB2=/\b(out|posted|released|assigned)\b/i;
/* Status notes, not deliverables. These carry a work noun and a row date but
   nothing is handed in: "Work on your final assignments", "ALL STUDENTS MUST SUBMIT…". */
/* Table column headers. "DATE DUE" is not a deadline; "Projektbericht due" is. */
/* What is left of a title once dates, weekdays and due-words are removed. An
   unnamed deliverable needs something of its own here — otherwise a fragment
   like "Due Monday, Oct. 25th." becomes a deadline called "Monday". */
const FILLER=/\b(mon|tues?|wed(nes)?|thur?s?|fri|satur|sun)(day)?s?\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b(due|by|before|after|at|on|the|of|in|and|is|was|now|no|later|than|submit|submitted|deadline|turn|hand|week|wk)\b/gi;
const core=t=>String(t||"").replace(FILLER," ").replace(/[^A-Za-z]+/g," ").trim();
const HEADERISH=/^(dates?|due|due date|date due|deliverables?|assessments?|items?|tasks?|topics?|week|weight|links?|notes?|readings?)[\s|:]*(due)?[\s|:]*$/i;
/* Sentences ABOUT an assessment, rather than an instance of one. Without this,
   an exam-policy paragraph yields one candidate per sentence: "The Midterm will
   cover material taught in the first half of the class", "You CANNOT be exempted
   from the Midterm", "NO MAKE-UPS OF Midterm WILL BE GIVEN." */
const POLICY=/\b(will\s+(be|cover|conduct|explain|provide|represent|have|also|subject|start|end)|would\s+be|cannot|can\s?not|may\s+not|must\s+not|should\s+not|do\s+not|does\s+not|are\s+not|is\s+not|no\s+make-?ups?|not\s+(allowed|permitted|feasible)|is\s+determined|are\s+determined|follows\s+the|please\s+(check|see|refer|note|ask)|consult\s+the|for\s+details|relative\s+to|be\s+exempted|open\s+book|academic\s+integrity|plagiaris|accommodat|OSAS|student\s+handbook|emergency|recording|unauthorized|discipline|university\s+policy|policies)/i;
const NOTASK=/^(work\s+(on|independently|through)\b|continues?\s+from\b|all students\b|see\s+(above|below|syllabus)\b|tba\b|tbd\b|n\/a\b)/i;
const ABBR=/\b(ch|chs|pp|p|dr|mr|mrs|ms|prof|vs|etc|no|ed|eds|vol|fig|sec|approx|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec|mon|tues|tue|wed|wedn|weds|thur|thurs|thu|fri|sat|sun|i\.e|e\.g|a\.m|p\.m|u\.s)\.\s/gi;
const TRAIL=/[\s,;:.–—-]*\b(due|deadline|submitted|submit|read|is|are|was|will be|on|by|at|before|through|no later than|week of|of|and|for|to|midnight|noon|starting|beginning)\b[\s,;:.–—-]*$/i;

function splitClauses(line){
  const out=[]; let cursor=0;
  line.split(/\s*\|\s*/).filter(s=>s.trim().length>2).forEach(part=>{
    part.replace(ABBR,m=>m.replace(".","\u0001"))
      .split(/(?:\.|;)\s+(?=[A-Z0-9"(])/)
      .forEach(s=>{
        const r=s.replace(/\u0001/g,".").trim();
        if(r.length>5 || CODEISH.test(r)){
          let at=line.indexOf(r.slice(0,18),cursor);
          if(at<0) at=cursor;
          out.push({t:r,at}); cursor=at+r.length;
        }
      });
  });
  return out.length?out:[{t:line.trim(),at:0}];
}
function stripDates(s){
  return s
    .replace(new RegExp("\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?("+MONWORD+")[a-z\u00e9\u00fc\u00e4]*\\.?,?(?:\\s*20\\d{2})?","gi")," ")
    .replace(new RegExp("\\b("+MONWORD+")[a-z\u00e9\u00fc\u00e4]*\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s*,?\\s*20\\d{2})?","gi")," ")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/(?:20)?\d{2})?\b/g," ")
    .replace(/\b20\d{2}-\d{1,2}-\d{1,2}\b/g," ")
    .replace(/\bweek\s*#?\s*\d{1,2}\b/gi," ");
}
function tidy(t){
  t=t.replace(/^\s*[•\-–—*·>|]+\s*/,"").replace(/^\d{1,2}[.)]\s*/,"")
     .replace(/^(due|deadline)\s*:?\s*/i,"").replace(/\s{2,}/g," ").trim();
  for(let i=0;i<6;i++){ const n=t.replace(TRAIL,"").trim(); if(!n||n.length<6||n===t) break; t=n; }
  return t.replace(/\((?:\s*(?:due|by|on|at|submit|before|sunday|monday|tuesday|wednesday|thursday|friday|saturday|[,.;:—–-])\s*)*\)/gi," ")
          .replace(/\s*[–—-]\s*[,;]/g,",").replace(/\s{2,}/g," ")
          .replace(/[\s,;:.–—-]+$/,"").replace(/^[\s,;:.–—-]+/,"").trim();
}

const TERMSTART={fall:[7,25],spring:[0,12],summer:[4,20],winter:[0,5]};

function monIdx(w){
  const k=String(w).toLowerCase().replace(/[.\u00e9\u00e8\u00fb]/g,c=>({"\u00e9":"e","\u00e8":"e","\u00fb":"u",".":""}[c]||c));
  if(MON[k]!==undefined) return MON[k];
  const three=k.slice(0,3);
  if(MON[three]!==undefined) return MON[three];
  const four=k.slice(0,4);
  return MON[four];
}
function toISO(y,m,d){ return y+"-"+String(m+1).padStart(2,"0")+"-"+String(d).padStart(2,"0"); }

function parse(rawLines, meta){
  const text=rawLines.join("\n");
  const head=rawLines.slice(0,16).join(" ");
  let code=null, codeFound=false;
  RE_COURSE.lastIndex=0;
  for(const c of [...head.matchAll(RE_COURSE)]){
    if(/^19\d{2}$/.test(c[2])) continue;
    if(/^(fall|autumn|spring|summer|winter|semester|term|week|room|suite|unit)$/i.test(c[1])) continue;
    code=c[1].toUpperCase()+" "+c[2]; codeFound=true; break;
  }
  if(!code){ const dm=head.match(RE_COURSE_DOT); if(dm){ code=dm[1]; codeFound=true; } }
  if(!code) code=(meta.name||"Course").replace(/\.[a-z]+$/i,"").slice(0,14);

  const tm=text.match(RE_TERM);
  const tm2=tm?null:text.match(RE_TERM2);
  const season = tm ? (tm[1].toLowerCase()==="autumn"?"fall":tm[1].toLowerCase()) : null;
  const yrM=text.slice(0,600).match(RE_YEAR);
  const year = tm ? +tm[2] : (tm2&&tm2[3] ? +tm2[3] : (yrM?+yrM[1]:new Date().getFullYear()));
  let termStart=null, termSource=null;
  if(season){ const ts=TERMSTART[season]; termStart=new Date(year,ts[0],ts[1]); termSource="season"; }
  const im=text.match(/^\s*(?:instructor|professor|taught by)\s*:?\s*(.+)$/im)
    || head.match(/\b((?:Prof|Dr|Professor)\.?\s+[A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,1})/);
  const instructor = im ? im[1].replace(/^[^|]*\|\s*/,"").replace(/\s*\|.*$/,"").trim().slice(0,60) : null;
  const ctM=head.match(/\b(\d{1,2}):(\d{2})\s*[-–—]\s*\d{1,2}:\d{2}\s*(a\.?m\.?|p\.?m\.?)/i);
  let classTime=null;
  if(ctM){ let h=+ctM[1]; if(/p/i.test(ctM[3])&&h<12)h+=12; classTime=String(h).padStart(2,"0")+":"+ctM[2]; }
  const dayM=head.match(RE_WKDAY);
  const classDay = dayM ? ({mon:1,tue:2,tues:2,wed:3,wednes:3,thu:4,thur:4,thurs:4,fri:5}[dayM[1].toLowerCase()]||2) : null;

  function yearFor(mIdx){
    if(season==="fall") return mIdx>=6 ? year : year+1;
    if(season==="spring") return mIdx<=6 ? year : year-1;
    return year;
  }
  // A row pairing a teaching week with a real date beats any assumption about term start.
  for(const l of rawLines){
    const w=l.match(RE_WEEK); if(!w) continue;
    let d=null;
    const i2=l.match(RE_ISO), m2=l.match(RE_MON), n2=l.match(RE_NUM);
    if(i2) d=new Date(+i2[1],+i2[2]-1,+i2[3]);
    else if(m2){ const mi=MON[m2[1].toLowerCase().slice(0,3)]; d=new Date(m2[3]?+m2[3]:yearFor(mi),mi,+m2[2]); }
    else if(n2){ const mi=+n2[1]-1; if(mi>=0&&mi<12)
      d=new Date(n2[3]?(+n2[3]<100?2000+ +n2[3]:+n2[3]):yearFor(mi),mi,+n2[2]); }
    if(!d||isNaN(d.getTime())) continue;
    d.setDate(d.getDate()-(+w[1]-1)*7);
    termStart=d; termSource="calibrated"; break;
  }
  if(meta.termStart){ termStart=new Date(meta.termStart+"T00:00:00"); termSource="user"; }
  function weekDate(n){
    if(!termStart) return null;
    const d=new Date(termStart); d.setDate(d.getDate()+(n-1)*7);
    if(classDay!==null){ const shift=(classDay-d.getDay()+7)%7; d.setDate(d.getDate()+shift); }
    return d;
  }

  const items=[], gaps=[], grading=[];
  const seen=new Set();

  // Many syllabi number their meetings instead of dating them.
  const SESSRE=/^(session|class|lecture|module)\s*#?\s*(\d{1,2})\b/i;
  const WORDNUM={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
  const marks=[];
  rawLines.forEach((l,i)=>{ const m=l.trim().match(SESSRE); if(m) marks.push({i,n:+m[2]}); });
  const sessionMode = marks.length>=3;
  let dueOffset=0, dueTime=null, offsetText="";
  if(sessionMode){
    const om=text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+days?\s+after\b/i);
    if(om){ dueOffset = WORDNUM[om[1].toLowerCase()] ?? +om[1]; offsetText=om[0]; }
    const ot=text.match(/due[^.\n]{0,60}?\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/i);
    if(ot){ let h=+ot[1]; const mi=+ot[2];
      if(ot[3]&&/p/i.test(ot[3])&&h<12) h+=12;
      if(ot[3]&&/a/i.test(ot[3])&&h===12) h=0;
      dueTime=String(h).padStart(2,"0")+":"+String(mi).padStart(2,"0"); }
  }
  function sessionDate(n){
    if(!termStart || !(termSource==="user"||termSource==="calibrated")) return null;
    const d=new Date(termStart); d.setDate(d.getDate()+(n-1)*7);
    return d;
  }
  function addDays(d,k){ const x=new Date(d); x.setDate(x.getDate()+k); return x; }

  const NOSESSION=/\bno\s+sess?ions?\b|\bno\s+class\b|thanksgiving|spring\s+break|fall\s+break|spring\s+recess|reading\s+week|holiday\b/i;
  function runSessionMode(){
    const seen2=new Set();
    // count breaks announced before each session so the calendar does not run early
    const skips=marks.map((mk,k)=>{
      let n=0;
      for(let j=0;j<k;j++){
        const e=Math.min(marks[j+1]?marks[j+1].i:rawLines.length, marks[j].i+40);
        if(NOSESSION.test(rawLines.slice(marks[j].i,e).join(" "))) n++;
      }
      return n;
    });
    marks.forEach((mk,k)=>{
      const end=Math.min(marks[k+1]?marks[k+1].i:rawLines.length, mk.i+40);
      const raw=rawLines.slice(mk.i,end);
      const block=raw.join(" ").replace(/\s{2,}/g," ");
      const sd=sessionDate(mk.n+skips[k]);
      const shifted=skips[k];
      const label="Session "+mk.n;

      const push=(kind,title,when,tm,extraWhy,conf,locator)=>{
        title=tidy(title).replace(/\s+/g," ").trim();
        if(!title||title.length<3) return;
        if(title.length>88) title=title.slice(0,85).replace(/\s\S*$/,"")+"…";
        const key=mk.n+"|"+kind+"|"+title.toLowerCase();
        if(seen2.has(key)) return; seen2.add(key);
        let atLine=mk.i;
        if(locator){
          const probe=String(locator).slice(0,22).trim();
          const j=raw.findIndex(r=>r.includes(probe));
          if(j>=0) atLine=mk.i+j;
        }
        if(!when){
          if(gaps.length<40) gaps.push({id:"s"+meta.fid+"-"+mk.n+"-"+seen2.size, code, file:meta.name,
            line:rawLines[atLine]||(label+" — "+title), ln:atLine+1, session:mk.n,
            note:"Dated by "+label+". Set your first class date and this becomes a real date."});
          return;
        }
        items.push({ id:"s"+meta.fid+"-"+mk.n+"-"+seen2.size, code, k:kind, t:title,
          d:toISO(when.getFullYear(),when.getMonth(),when.getDate()), tm,
          c:conf, why:[["+",label+" mapped from the first class date you set"]]
            .concat(shifted?[["+",shifted+" break week"+(shifted>1?"s":"")+" announced earlier in the syllabus pushed this later"]]:[])
            .concat(extraWhy),
          line:rawLines[atLine]||(label+" — "+title), ln:atLine+1,
          matched:label, on:true, edited:false, file:meta.name });
      };

      // graded work: "Assignment #4 (Team) – Product Backlog"
      let m;
      const are=/\b(assignment|homework|hw|problem\s*set|pset|ps|project|deliverable|milestone|lab|quiz|paper|essay|report|memo|case\s*study)\s*#?\s*(\d{1,3})\b\s*(?:\(([^)]{0,18})\))?\s*[–—:-]?\s*([^|]{0,64})/gi;
      while((m=are.exec(block))!==null){
        const noun=m[1].replace(/\s+/g," ").trim();
        const kind=/quiz/i.test(noun)?"x":"a";
        const label=noun.charAt(0).toUpperCase()+noun.slice(1);
        const who=m[3]?" ("+m[3].trim()+")":"";
        const tail=(m[4]||"").split(/\s{2,}|Due:|•/)[0];
        const inClassKind = kind==="x" || /^lab$/i.test(noun);
        const when = (sd && dueOffset && !inClassKind) ? addDays(sd,dueOffset) : sd;
        push(kind, label+" #"+m[2]+who+(tail.trim()?" — "+tail.trim():""), when,
          inClassKind ? (classTime||"09:00") : (dueTime||"23:59"),
          (dueOffset&&!inClassKind)
            ?[["+",'Syllabus due rule: "'+offsetText+' the session"'+(dueTime?", at "+dueTime:"")]]
            :[["−","No due date given for this item — placed on the session itself"]],
          (dueOffset&&!inClassKind)?.78:.66, m[0]);
      }
      // exams
      const ex=block.match(/\b(Midterm(?:\s+Exam)?|Final\s+Exam|End[\s-]of[\s-]Course\s+Exam)\b/i);
      if(ex) push("x",ex[1].replace(/\s+/g," "),sd,classTime||"18:30",
        [["−","Exam named in this session block; no separate date given"]],.70,ex[0]);
      // in-class presentations
      if(/\bTeam Presentations\b/.test(block))
        push("a","Team Presentations",sd,classTime||"18:30",
          [["·","Listed in the session block as an in-class activity"]],.70,"Team Presentations");
      // readings
      const rre=/\b([A-Z][A-Za-z]{2,14})\s+Ch\.?\s*(\d{1,2})(?:\s*[–—-]\s*([A-Za-z][A-Za-z ]{1,24}))?/g;
      while((m=rre.exec(block))!==null){
        if(/^(the|and|for|session|class|week|figure|table)$/i.test(m[1])) continue;
        push("r","Read "+m[1]+" Ch. "+m[2]+(m[3]?" — "+m[3].trim():""),sd,classTime||"09:00",
          [["·","Reading listed for this session"]],.68,m[0]);
      }
      const hre=/\b(HBR|Article|Case)\s*:\s*([^|•]{3,44})/gi;
      while((m=hre.exec(block))!==null)
        push("r","Read "+m[1]+": "+m[2].trim(),sd,classTime||"09:00",
          [["·","Reading listed for this session"]],.66,m[0]);
    });
  }

  // ---- is 03/04 the 3rd of April or March 4th? Let the document answer. ----
  const RE_NUM_G=/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?\b/g;
  let dayFirst=null, orderWhy="";
  // "24/7 on call" and "1/2 of the grade" are not dates: only trust a slash pair that
  // carries a year or sits next to scheduling language.
  const DATECTX=/\b(due|date|dated|week|class|session|exam|quiz|assignment|submit|deadline|updated|revised)\b/i;
  for(const n of text.matchAll(RE_NUM_G)){
    const around=text.slice(Math.max(0,n.index-40), n.index+n[0].length+40);
    if(!n[3] && !DATECTX.test(around)) continue;
    if(+n[1]>12 && +n[1]<=31){ dayFirst=true;  orderWhy='"'+n[0]+'" can only be day-first'; break; }
    if(+n[2]>12 && +n[2]<=31){ dayFirst=false; orderWhy='"'+n[0]+'" can only be month-first'; break; }
  }
  if(dayFirst===null){
    // no decisive date: see which reading agrees with the weekdays the syllabus states
    let md=0, dm=0;
    const DAYN={sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6};
    rawLines.forEach(l=>{
      const w=l.match(RE_WKDAY); if(!w) return;
      const n=l.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?\b/); if(!n) return;
      const want=DAYN[w[1].toLowerCase().slice(0,3)];
      const yy=n[3]?(+n[3]<100?2000+ +n[3]:+n[3]):year;
      const a=new Date(yy,+n[1]-1,+n[2]), b=new Date(yy,+n[2]-1,+n[1]);
      if(+n[2]<=12 && a.getMonth()===+n[1]-1 && a.getDay()===want) md++;
      if(+n[1]<=12 && b.getMonth()===+n[2]-1 && b.getDay()===want) dm++;
    });
    if(md!==dm){ dayFirst = dm>md; orderWhy="the weekdays in this syllabus agree with "+(dm>md?"day-first":"month-first"); }
  }
  const orderAssumed = dayFirst===null;
  if(meta.dateOrder){ dayFirst = meta.dateOrder==="dmy"; orderWhy="you set this"; }
  else if(dayFirst===null) dayFirst=false;

  function allDates(str){
    const found=[];
    let m;
    const rx=(re,fn)=>{ const g=new RegExp(re.source,"gi"); while((m=g.exec(str))!==null){ const r=fn(m); if(r){ r.i=m.index; r.m=m[0];
      const after=str.slice(m.index+m[0].length);
      r.range=/^\s*[-–—]\s*(\d{1,2}\b|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(after);
      r.end=m.index+m[0].length;
      found.push(r); } } };
    rx(RE_ISO, m=>({d:toISO(+m[1],+m[2]-1,+m[3]),yr:true}));
    rx(RE_DOT, m=>{ const dd=+m[1], mi=+m[2]-1;           // day.month.year everywhere it is used
      if(mi<0||mi>11||dd<1||dd>31) return null;
      return {d:toISO(+m[3],mi,dd),yr:true}; });
    rx(RE_DMY, m=>{ const mi=monIdx(m[2]); const dd=+m[1];
      if(mi===undefined||dd<1||dd>31) return null;
      return {d:toISO(m[3]?+m[3]:yearFor(mi),mi,dd),yr:!!m[3]}; });
    rx(RE_MON, m=>{ const mi=monIdx(m[1]); const dd=+m[2];
      if(mi===undefined) return null;
      if(dd<1||dd>31) return null; return {d:toISO(m[3]?+m[3]:yearFor(mi),mi,dd),yr:!!m[3]}; });
    rx(RE_NUM, m=>{
      let mi=+m[1]-1, dd=+m[2];
      if(dayFirst && +m[1]<=31 && +m[2]<=12){ mi=+m[2]-1; dd=+m[1]; }
      if(mi<0||mi>11||dd<1||dd>31) return null;
      const yy=m[3]?(+m[3]<100?2000+ +m[3]:+m[3]):yearFor(mi);
      return {d:toISO(yy,mi,dd),yr:!!m[3],numeric:true}; });
    rx(RE_WEEK, m=>{ const d=weekDate(+m[1]); if(!d) return null;
      return {d:toISO(d.getFullYear(),d.getMonth(),d.getDate()),yr:false,wk:true,n:+m[1]}; });
    // strongest first at the same position: iso/month/numeric beat week numbers
    found.sort((a,b)=>(a.wk?1:0)-(b.wk?1:0) || a.i-b.i);
    // "June 27-July 1" is one span: the second date is the end of a range, not a deadline
    const byPos=found.filter(x=>!x.wk).sort((a,b)=>a.i-b.i);
    byPos.forEach((d,j)=>{ const prev=byPos[j-1];
      if(prev && /^\s*[-–—]\s*$/.test(str.slice(prev.end,d.i))) d.rangeEnd=true; });
    return found;
  }
  function pickDate(str){
    const all=allDates(str);
    if(!all.length) return null;
    let hard=all.filter(x=>!x.wk);
    // "June 27-July 1" is one span: drop the end date so the start always wins
    hard=hard.filter(x=>!x.rangeEnd);
    const pool=hard.length?hard:all.filter(x=>!x.rangeEnd);
    if(!pool.length) return null;
    const dm=str.match(DUE);
    if(RESCHED.test(str) && pool.length>1) return Object.assign({},pool[pool.length-1],{many:true,resched:true});
    if(dm && pool.length>1){
      const at=str.indexOf(dm[0]);
      const after=pool.filter(x=>x.i>=at).sort((a,b)=>a.i-b.i);
      if(after.length) return Object.assign({},after[0],{many:pool.length>1});
    }
    return Object.assign({},pool[0],{many:pool.length>1});
  }
  const DAYNAME={sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6};

  rawLines.forEach((raw,idx)=>{
    const line=raw.trim();
    if(line.length<8) return;
    if(/[<>]\s*\d{1,3}\s*%/.test(line)) return;

    const gm=line.match(/^(.{2,40}?)\s+(\d{1,3})\s*%\s*$/);
    if(gm){ grading.push([gm[1].replace(/[|\s]+$/,"").trim(),gm[2]+"%"]); return; }
    if(line.includes("|")){
      const cells=line.split(/\s*\|\s*/).map(c=>c.trim()).filter(Boolean);
      const pc=cells.find(c=>/^\d{1,3}\s*%$/.test(c));
      if(pc){ const lab=cells.filter(c=>c!==pc && /[a-z]{4}/i.test(c)).sort((a,b)=>b.length-a.length)[0];
        if(lab) grading.push([lab.replace(/:$/,"").slice(0,44),pc.replace(/\s/g,"")]); }
    }
    if(CITE.test(line) && !DUE.test(line)) return;

    if(sessionMode) return;
    const lineAllRaw=allDates(line);
    const lineHard=lineAllRaw.filter(x=>!x.wk && !x.rangeEnd);
    const linePool=lineHard.length?lineHard:lineAllRaw.filter(x=>!x.rangeEnd);
    const clauses=splitClauses(line);
    const isRow=line.includes("|");
    const rowHasDue=isRow && clauses.some(c=>DUE.test(c.t));
    const cdates=clauses.map(c=>pickDate(c.t));
    let madeOnLine=0;

    clauses.forEach((cl,ci)=>{
      const seg=cl.t;
      if(madeOnLine>=4) return;
      const isExam=EXAM.test(seg), isRead=READ.test(seg), hasDue=DUE.test(seg);
      const isCode=isRow && CODEISH.test(seg.trim())
        && !EXAM.test(seg) && !READ.test(seg) && !WORK.test(seg);
      const isWork=WORK.test(seg) || isCode;
      /* Says something is due but names nothing the vocabulary knows. Three words
         minimum keeps out column headers like "DATE DUE" and "Deliverable". */
      const unnamed = hasDue && !isExam && !isRead && !isWork
        && seg.trim().length>6 && !HEADERISH.test(seg.trim());
      if(!(isExam||isRead||isWork||unnamed)) return;
      if(NOISE.test(seg) && !hasDue && seg.length<48) return;
      if(rowHasDue && !hasDue && !isExam && !isRead) return;
      if(NEG.test(seg)) return;
      if(/\boffice hours?\b/i.test(seg)) return;
      if(NOTASK.test(seg.trim())) return;
      /* Policy prose only — a real schedule cell is short and states no policy. */
      if(POLICY.test(seg) && !(/\bdue\b/i.test(seg) && seg.length<70)) return;

      const own=pickDate(seg);
      let hit=own, inherited=null;
      if(!hit && isRow && linePool.length){
        // table row: the date cell sits just before its note
        const before=linePool.filter(x=>x.i<cl.at).sort((a,b)=>b.i-a.i)[0];
        const after=linePool.filter(x=>x.i>=cl.at).sort((a,b)=>a.i-b.i)[0];
        hit = before||after; inherited = before?"before":"after";
      } else if(!hit){
        // prose: only borrow from the sentence right next door, and only if it states a deadline
        for(const j of [ci+1,ci-1]){
          if(j<0||j>=clauses.length||!cdates[j]) continue;
          if(!DUE.test(clauses[j].t)) continue;
          hit=cdates[j]; inherited="adjacent"; break;
        }
      }
      const why=[]; let base=.55;

      let t=tidy(stripDates(seg).replace(RE_TIME," "));
      if(t.length>92) t=t.slice(0,89).replace(/\s\S*$/,"")+"…";
      if(unnamed && core(t).length<3) return;

      const weekOnly = !hit && !termStart && (RE_WEEK.test(seg) || (!linePool.length && RE_WEEK.test(line)));
      if(weekOnly){
        if(gaps.length<30) gaps.push({id:"g"+meta.fid+"-"+idx+"-"+ci, code, file:meta.name, line:seg, ln:idx+1,
          week:+((seg.match(RE_WEEK)||line.match(RE_WEEK))[1]),
          note:"Dated by teaching week "+((seg.match(RE_WEEK)||line.match(RE_WEEK))[1])+". Set the term start date and this becomes a real date."});
        return;
      }
      if(!hit){
        const rec=seg.match(/\b(weekly|each week|every week|every (mon|tues?|wed(nes)?|thur?s?|fri)[a-z]*)\b/i);
        if(rec && (isWork||isExam) && t.length>5){
          const d0=weekDate(1);
          madeOnLine++;
          items.push({ id:meta.fid+"-"+idx+"-"+ci+"r", code, k:isExam?"x":"a", t,
            d:toISO(d0.getFullYear(),d0.getMonth(),d0.getDate()), tm:classTime||"23:59",
            c:.62, rrule:"FREQ=WEEKLY;COUNT=14",
            why:[["+",'Recurring — the line says "'+rec[0]+'"'],
                 ["−","No dates listed, so it starts at the first class meeting"],
                 ["·","Repeats weekly for 14 weeks — change the count in your calendar if the term is shorter"]],
            line:seg, ln:idx+1, matched:rec[0], on:true, edited:false, file:meta.name });
          return;
        }
        if(isExam && !isWork && !hasDue && seg.length>70) return;
        if((isWork||isExam||unnamed) && (GAPVERB.test(seg)||isExam) && (/\bdue\b/i.test(seg) || isExam || !GAPVERB2.test(seg)) && gaps.length<30){
          gaps.push({id:"g"+meta.fid+"-"+idx+"-"+ci, code, file:meta.name, line:seg, ln:idx+1,
            note:/\bt\.?b\.?[ad]\b/i.test(seg) ? "The syllabus itself says TBD."
              : /\b(week|term|finals|end of|at some point)\b/i.test(seg)
              ? "Names a rough time, but no date Syllify could resolve."
              : "No date anywhere on this line."});
        }
        return;
      }
      if(!t || (t.length<5 && !CODEISH.test(t))) return;

      const key=code+"|"+t.toLowerCase()+"|"+hit.d;
      if(seen.has(key)) return; seen.add(key);

      const k = isExam ? "x" : (isRead && !isWork) ? "r" : "a";
      if(unnamed){ base-=.16; why.push(["−","Line says something is due, but Syllify does not recognise the item by name"]); }

      let tmS = k==="r" ? "09:00" : "23:59";
      const tmatch=seg.match(RE_TIME)||line.match(RE_TIME);
      if(tmatch && seg.match(RE_TIME)){
        let h=+tmatch[1]; const mi=tmatch[2]?+tmatch[2]:0; const pm=/p/i.test(tmatch[3]);
        if(pm&&h<12)h+=12; if(!pm&&h===12)h=0;
        tmS=String(h).padStart(2,"0")+":"+String(mi).padStart(2,"0");
      } else if(/\b(1[3-9]|2[0-3]):([0-5]\d)\b/.test(seg)){
        const h24=seg.match(/\b(1[3-9]|2[0-3]):([0-5]\d)\b/);
        tmS=h24[1].padStart(2,"0")+":"+h24[2];
      } else if(/\bmidnight\b/i.test(seg)) tmS="23:59";
        else if(/\bnoon\b/i.test(seg)) tmS="12:00";
      const inClass = /\bin[- ]class\b|\bpresented in class\b/i.test(seg) && classTime && !seg.match(RE_TIME);
      if(inClass) tmS=classTime;

      if(hit.wk){
        if(termSource==="user"||termSource==="calibrated"){ base-=.04;
          why.push(["+",'Teaching week "'+hit.m+'" mapped against the term start '+
            (termSource==="user"?"you set":"found in this syllabus")]); }
        else { base-=.13; why.push(["−",'No date on the row — resolved from "'+hit.m+'" against an assumed term calendar']); }
      }
      else { base+=hit.yr?.20:.15; why.push(["+","Date read off the page"+(hit.yr?", with a year":", year inferred from the term")]); }
      if(!own && hit){
        if(/\|/.test(line) && inherited==="before"){ base+=.02; why.push(["+","Date taken from the cell just before this note in the row"]); }
        else if(/\|/.test(line)){ base-=.04; why.push(["−","No date before this note in the row — used the next one along"]); }
        else { base-=.06; why.push(["−","Date came from elsewhere in the same sentence block"]); }
      }
      if(hit && hit.numeric){
        if(orderAssumed){ base-=.07; why.push(["−",'Numeric date read as '+(dayFirst?"day/month":"month/day")+' — the syllabus never says which']); }
        else if(orderWhy) why.push(["+",'Read as '+(dayFirst?"day/month":"month/day")+' because '+orderWhy]);
      }
      if(hit && hit.range){ base-=.08; why.push(["−",'Row covers a date range ("'+hit.m+'-…") — used the first day']); }
      if(hit && hit.resched){ why.push(["+",'Line reschedules the deadline — took the later date']); }
      if(hasDue){ base+=.13; why.push(["+",'Line states a due date or submission']); }
      else if(/\b(before|by|prior to|no later than)\b/i.test(seg)){ base+=.07; why.push(["+",'Date is framed as a cutoff ("before" / "by")']); }
      else { base-=.03; why.push(["−",'No explicit "due" wording']); }
      if(seg.match(RE_TIME)){ base+=.08; why.push(["+","Time of day stated on the line"]); }
      else if(inClass){ base+=.06; why.push(["+","Marked in class — used the meeting time from the header"]); }
      else if(k!=="r"){ base-=.05; why.push(["−","No time stated — defaulted to 11:59 PM"]); }
      else why.push(["·","No time stated — readings default to 9:00 AM"]);
      const dn=seg.match(/\b(sun|mon|tues?|wednes|wed|thur?s?|fri|satur)(day)?\b/i);
      if(dn){
        const want=DAYNAME[dn[1].toLowerCase().slice(0,3)];
        const [yy,mm,dd2]=hit.d.split("-").map(Number);
        const got=new Date(yy,mm-1,dd2).getDay();
        if(want===got){ base+=.05; why.push(["+","Weekday on the line matches that date"]); }
        else { base-=.11; why.push(["−","Line says "+dn[0]+", but that date is a "+
          ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][got]]); }
      }
      if(hit.many){ base-=.05; why.push(["−","Several dates on this line — took the one tied to the deadline"]); }
      if(isCode){ base-=.05; why.push(["−",'Row cell is a short code ("'+seg.trim()+'") — Syllify kept it but cannot tell what kind of work it is']); }
      else if(isExam||isWork){ base+=.07; why.push(["+","Names a recognized deliverable"]); }
      else if(isRead && /\b(ch\.?\s*\d|chapter|pp\.?\s*\d|pages)\b/i.test(seg)){ base+=.06; why.push(["+","Reading cites a chapter or page range"]); }
      if(seg.length>150){ base-=.07; why.push(["−","Long table row — the title may carry extra cells"]); }
      if(/recommended|optional/i.test(seg)){ base-=.10; why.push(["−","Marked recommended or optional"]); }
      if(/revision|accepted through/i.test(line)){ base-=.06; why.push(["−","More than one date on the row — took the first"]); }

      madeOnLine++;
      items.push({ id:meta.fid+"-"+idx+"-"+ci, code, k, t, d:hit.d, tm:tmS, numeric:!!hit.numeric,
        c:Math.max(.34,Math.min(.99,base)), why, line:seg, ln:idx+1, matched:hit.m,
        on:true, edited:false, file:meta.name });
    });
  });

  if(sessionMode) runSessionMode();
  // Is this a syllabus at all? Cheap signals, so a resume or an invoice is caught.
  const sig=[];
  let score=0;
  if(codeFound){ score+=2; sig.push("course code"); }
  if(tm||tm2){ score+=1; sig.push("term"); }
  const dateCount=(text.match(new RegExp("\\b("+MONWORD+")[a-z]*\\.?\\s+\\d{1,2}\\b","gi"))||[]).length
    + (text.match(new RegExp("\\b\\d{1,2}(?:st|nd|rd|th)?\\s+("+MONWORD+")","gi"))||[]).length
    + (text.match(/\b\d{1,2}\/\d{1,2}\b/g)||[]).length;
  if(dateCount>=3){ score+=2; sig.push(dateCount+" dates"); }
  else if(marks.length>=3||(text.match(RE_WEEK)||[]).length){ score+=2; sig.push("session or week numbers"); }
  const vocab=["syllabus","schedule","assignment","reading","exam","grading","instructor","due","office hours","prerequisite","attendance","academic integrity"]
    .filter(w=>new RegExp("\\b"+w,"i").test(text));
  score+=Math.min(4,vocab.length);
  if(vocab.length) sig.push(vocab.length+" syllabus terms");
  const likely = score>=5;

  // ---- self-consistency: is anything outside the term it claims? ----
  if(termStart){
    const lo=new Date(termStart); lo.setDate(lo.getDate()-14);
    const hi=new Date(termStart); hi.setDate(hi.getDate()+7*22);
    items.forEach(it=>{
      const d=new Date(it.d+"T00:00:00");
      if(d<lo||d>hi){ it.c=Math.max(.3,it.c-.18);
        it.why=it.why.concat([["−","This date falls outside the term this syllabus covers"]]); }
    });
  }

  const merged=[];
  items.forEach(it=>{
    const lo=it.t.toLowerCase();
    const dup=merged.find(o=>o.d===it.d && o.k===it.k &&
      (o.t.toLowerCase().includes(lo) || lo.includes(o.t.toLowerCase())));
    if(dup){
      if(it.t.length>dup.t.length) dup.t=it.t;
      if(it.c>dup.c){ dup.c=it.c; dup.why=it.why; dup.line=it.line; dup.ln=it.ln; }
      return;
    }
    merged.push(it);
  });
  merged.sort((a,b)=>a.d.localeCompare(b.d));
  items.length=0; merged.forEach(m=>items.push(m));
  /* A long, clearly-syllabus document with plenty of text and almost no dates in it
     has had its schedule table flattened into a picture. Very common in Word-to-PDF
     exports. The document parses fine; the one page that matters is an image. Say so,
     rather than showing a page of policy prose and calling it a result. */
  const dateLines = rawLines.reduce((n,l)=>n+(allDates(l).some(x=>!x.wk)?1:0),0);
  const noSchedule = likely && items.length===0 && !sessionMode && !RE_WEEK.test(text)
    && rawLines.length>=40 && dateLines<6;

  return { code, term: tm?(tm[1][0].toUpperCase()+tm[1].slice(1).toLowerCase()+" "+tm[2]):null,
    instructor, items, gaps, grading, lines:rawLines.length, classTime, termStart, termSource,
    likely, docScore:score, signals:sig, dayFirst, orderAssumed, orderWhy, dateLines, noSchedule,
    hasNumericDates: /\b\d{1,2}\/\d{1,2}\b/.test(text),
    needsTermStart: !termStart && (RE_WEEK.test(text)||sessionMode), sessionMode,
    words:(text.match(/\S+/g)||[]).length, name:meta.name };
}



/* Clean a raw line list: drop repeated page furniture, rejoin wrapped sentences. */
function prepLines(lines){
  const tally={};
  lines.forEach(l=>{tally[l]=(tally[l]||0)+1;});
  const kept=lines.filter(l=>{
    if(l.length<3) return false;
    if(tally[l]>=3 && l.length<70) return false;
    if(/^page\s*\d+(\s*of\s*\d+)?$/i.test(l)) return false;
    return true;
  });
  /* PDFs and spreadsheets hand us tab-separated rows. Treat a tab like a pipe so
     column attribution works and titles stop carrying the whole row. */
  const cols=kept.map(l=>l.includes("\t")?l.replace(/\t+/g," | ").replace(/\s*\|\s*/g," | ").trim():l);
  /* A real schedule row almost always opens with a week, session or date. A fragment
     left behind by a PDF line-wrap does not — so anything that is not a row opener,
     following a row that is, is the tail of that row. Without this, one wrapped table
     row becomes three unrelated lines and its date and its deliverable never meet. */
  const ROWSTART=/^(week|wk|session|ses|class|lecture|lec|module|unit|day|part|topic|assessment|assignment)\s*#?\s*\d|^\d{1,2}\s*[|.)\-]|^(mon|tues?|wed(nes)?|thur?s?|fri|satur|sun)(day)?\b|^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d|^\d{1,2}[-\/.]\d{1,2}|^\d{1,2}\s*[-\/]\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
  const out=[];
  cols.forEach(l=>{
    const prev=out[out.length-1];
    const proseWrap = prev && !prev.includes("|") && !l.includes("|") && prev.length>35 && l.length<130
      && !/[.:;!?]$/.test(prev) && (/^[a-z(]/.test(l) || /^(AM|PM)\b/.test(l));
    /* A tail with no pipe of its own, following a real table row and not opening a
       new one, is that row's continuation. Deliberately conservative: a tail that
       still carries a pipe is left alone, because treating row openers as the only
       boundary glues legitimate rows together in real documents (verified against
       UTas assessment tables and MIT 7.016). PDF line-wrap is therefore improved,
       not solved — see the known limitations. */
    const tableWrap = prev && prev.split("|").length>=2 && !l.includes("|")
      && !ROWSTART.test(l) && l.length>18 && l.length<170;
    if(proseWrap || tableWrap) out[out.length-1]=prev+" "+l;
    else out.push(l);
  });
  return out;
}



/**
 * Check a model's proposed items against the real document.
 * Every proposal must cite a line that exists, and the words of its title must
 * appear on that line. A date, if given, must parse and sit inside the term.
 * Returns { kept, rejected } — rejected carries the reason.
 */
export function verifyProposals(proposals, lines, opts = {}) {
  const kept = [], rejected = [];
  const toks = t => String(t || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 3);
  (Array.isArray(proposals) ? proposals : []).forEach((r, n) => {
    const title = String((r && r.title) || "").trim();
    const ln = Number(r && r.line);
    if (!title) { rejected.push({ title: "(untitled)", reason: "no title" }); return; }
    if (!Number.isInteger(ln) || ln < 0 || ln >= lines.length) {
      rejected.push({ title, reason: "cites no real line" }); return;
    }
    const src = lines[ln];
    const t = toks(title);
    if (t.length && !t.some(w => src.toLowerCase().includes(w))) {
      rejected.push({ title, reason: "does not appear on line " + ln }); return;
    }
    let d = null;
    if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && !isNaN(new Date(r.date + "T00:00:00").getTime())) d = r.date;
    if (d && opts.termStart) {
      const lo = new Date(opts.termStart); lo.setDate(lo.getDate() - 21);
      const hi = new Date(opts.termStart); hi.setDate(hi.getDate() + 7 * 24);
      const at = new Date(d + "T00:00:00");
      if (at < lo || at > hi) { rejected.push({ title, reason: "date falls outside the term" }); return; }
    }
    kept.push({
      title: title.slice(0, 92),
      type: /exam|quiz|midterm|final/i.test(r.type || "") ? "exam" : /read/i.test(r.type || "") ? "reading" : "assignment",
      date: d,
      time: (typeof r.time === "string" && /^\d{2}:\d{2}$/.test(r.time)) ? r.time : null,
      source_line_number: ln,
      source_line: src,
      verified: true,
    });
  });
  return { kept, rejected };
}

export { prepLines, parse };
