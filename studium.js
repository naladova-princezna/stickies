(function(){
'use strict';
var HOST=(window.parent&&window.parent!==window&&window.parent.StickiesStudy)||null;
var STATUT={A:'Povinný',B:'Povinně volitelný',C:'Volitelný'};
var SCOL={A:'#2563eb',B:'#0f766e',C:'#b45309'};
var TYPES={'Zk':'Zkouška','Zk+':'Zkouška se zápočtem','Zp':'Zápočet','Ko':'Kolokvium','Ko+':'Kolokvium se zápočtem','Szv':'Státní zkouška'};
var TEMPLATES={
  'Zk':[['Příprava ke zkoušce',1],['Zkouška',2]],
  'Zk+':[['Zápočet před zkouškou',1],['Zkouška',2]],
  'Zp':[['Splnit podmínky zápočtu',1],['Zápočet',1]],
  'Ko':[['Podmínky kolokvia',1],['Kolokvium',1]],
  'Ko+':[['Zápočet',1],['Kolokvium',2]],
  'Szv':[['Státní zkouška',1]]
};
var GRADES=[['','zatím bez výsledku'],['A','A (1)'],['B','B (1,5)'],['C','C (2)'],['D','D (2,5)'],['E','E (3)'],['F','F – nevyhověl (4)'],['S','S – splněno']];
var GV={A:1,B:1.5,C:2,D:2.5,E:3,F:4};
var KINDS={prednaska:'Přednáška',cviceni:'Cvičení',seminar:'Seminář'};
var CH_ST={todo:'Nezačato',wip:'Rozpracováno',done:'Hotovo'};
var CH_NEXT={todo:'wip',wip:'done',done:'todo'};
var ROUTES=[['prehled','Přehled'],['deadliny','Termíny'],['predmety','Předměty'],['zapisy','Zápisy'],['prace','Práce']];
var ALIAS={};
var PRAISE=['Hotovo. Dobrá práce.','Odškrtnuto. Jedna věc méně.','Splněno. Dej si chvilku.','Další krok máš za sebou.','Skvěle, to je z cesty.'];
var DAYS=['ne','po','út','st','čt','pá','so'];
var THESIS_COLOR='#0e7490';

var S=null, D=null, route='prehled', saveTimer=null, filterSubj='', snap='[]';
var fl={term:'cur',statut:'',q:''};
var ui={open:{},fold:{},show:{},qa:{sid:'',due:'week',text:'',date:''}};

/* ---------- pomocné ---------- */
function $(s){return document.querySelector(s);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function uid(){return Math.random().toString(36).slice(2,9);}
function pad(n){return String(n).padStart(2,'0');}
function ymd(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function today(){return ymd(new Date());}
function diff(s){return Math.round((new Date(s+'T00:00:00')-new Date(today()+'T00:00:00'))/864e5);}
function dny(n){n=Math.abs(n);return n===1?'den':(n>=2&&n<=4?'dny':'dní');}
function fmt(s){if(!s)return '';var d=new Date(s+'T00:00:00');return DAYS[d.getDay()]+' '+d.getDate()+'. '+(d.getMonth()+1)+'.'+(d.getFullYear()!==new Date().getFullYear()?' '+d.getFullYear():'');}
function fmtShort(s){if(!s)return '';var d=new Date(s+'T00:00:00');return d.getDate()+'. '+(d.getMonth()+1)+'. '+d.getFullYear();}
function rel(s){var d=diff(s);if(d===0)return 'dnes';if(d===1)return 'zítra';if(d===-1)return 'včera';return d>0?'za '+d+' '+dny(d):'před '+(-d)+' '+dny(d);}
function num(x){return String(x).replace('.',',');}
function curTerm(){
  var d=new Date(),m=d.getMonth()+1,y=d.getFullYear(),st=m>=9?y:y-1;
  return {year:pad(st%100)+'/'+pad((st+1)%100),sem:(m>=9||m===1)?'ZS':'LS'};
}
function tkey(s){return s.year+' '+s.sem;}
function tlabel(k){var p=k.split(' ');if(!p[0])return 'Bez semestru';return '20'+p[0].slice(0,2)+'/'+p[0].slice(3)+' '+p[1];}
function tsort(a,b){var A=a.split(' '),B=b.split(' ');if(A[0]!==B[0])return A[0]<B[0]?-1:1;return A[1]===B[1]?0:(A[1]==='ZS'?-1:1);}
function col(s){return s.color||SCOL[s.statut]||'#64748b';}

/* ---------- výpočty ---------- */
function passed(s){return !!s.grade&&s.grade!=='F';}
function failed(s){return s.grade==='F';}
function prog(s){
  if(passed(s))return 100;
  var t=0,d=0;s.reqs.forEach(function(r){t+=r.weight;if(r.done)d+=r.weight;});
  if(!t)return 0;if(d===t)return 100;return Math.min(99,Math.round(100*d/t));
}
function ready(s){return !passed(s)&&s.reqs.length>0&&prog(s)===100;}
function creditsEarned(){return D.subjects.reduce(function(a,s){return a+(passed(s)?s.credits:0);},0);}
function creditsListed(){return D.subjects.reduce(function(a,s){return a+s.credits;},0);}
function creditsMin(){return Number(D.minCredits)||creditsListed();}
function overallPct(){var m=creditsMin();return m?Math.min(100,Math.round(100*creditsEarned()/m)):0;}
function wavg(list){
  var k=0,w=0;list.forEach(function(s){if(GV[s.grade]!=null){k+=GV[s.grade]*s.credits;w+=s.credits;}});
  return w?k/w:null;
}
function avgStr(list){var a=wavg(list);return a==null?'–':(Math.round(a*100)/100).toFixed(2).replace('.',',');}
function inTerm(s,t){return s.year===t.year&&s.sem===t.sem;}
function allReqs(){var out=[];D.subjects.concat([thesisSubj()]).forEach(function(s){s.reqs.forEach(function(r){out.push({s:s,r:r});});});return out;}
function dueList(){return allReqs().filter(function(x){return x.r.due&&!x.r.done&&!passed(x.s);}).sort(function(a,b){return a.r.due<b.r.due?-1:1;});}
function thesisLabel(st){st=st||D;var l=st.level;return l==='bc'?'Bakalářská práce':(l==='nmgr'||l==='mgr')?'Diplomová práce':l==='phd'?'Disertační práce':'Závěrečná práce';}
function thesisSubj(){return {id:'thesis:'+D.id,name:thesisLabel()+' a státnice',color:THESIS_COLOR,credits:0,type:'thesis',reqs:D.thesis.tasks,thesis:true,statut:'A',grade:''};}
function subj(id){if(String(id).indexOf('thesis:')===0)return thesisSubj();return D.subjects.filter(function(s){return s.id===id;})[0];}
function cur(){var f=S.studies.filter(function(x){return x.id===S.active;})[0];return f||S.studies[0];}
function chPages(){return D.thesis.chapters.reduce(function(a,c){return a+(Number(c.pages)||0);},0);}

/* ---------- data ---------- */
function emptyThesis(){return {title:'',supervisor:'',department:'',targetPages:60,dates:{assign:'',submit:'',exam:'',defense:''},tasks:[],chapters:[],consultations:[],notes:''};}
var LEVELS={bc:'Bakalářské studium',nmgr:'Navazující magisterské studium',mgr:'Magisterské studium',phd:'Doktorské studium',other:'Jiné studium'};
var LEVEL_SHORT={bc:'Bc.',nmgr:'NMgr.',mgr:'Mgr.',phd:'Ph.D.'};
function emptyStudy(id,level){
  level=LEVELS[level]?level:(LEVELS[id]?id:'other');
  var bc=level==='bc';
  return {id:id,level:level,name:LEVELS[level],programme:'',faculty:'',form:'',
    yearsStd:bc?3:2,yearsMax:bc?6:5,yearsEnrolled:'',yearsLeft:'',minCredits:0,planCredits:0,stagAvg:'',stagDate:'',
    hasThesis:!bc,category_id:'',taskMode:'due',aprobs:[],subjects:[],sessions:[],milestones:[],blocks:[],thesis:emptyThesis()};
}
var OLD_TYPE={zkouska:'Zk',zapocet:'Zp',klas:'Zp',kolokvium:'Ko',sp:'Zp'};
function fixSubject(s){
  s.reqs=Array.isArray(s.reqs)?s.reqs:[];s.reqs.forEach(function(r){if(r.note==null)r.note='';});s.credits=Number(s.credits)||0;
  s.code=s.code||'';s.year=s.year||'';s.sem=s.sem||'';s.hours=s.hours||'';s.zdate=s.zdate||'';s.gdate=s.gdate||'';s.rel=s.rel||'';
  if(!STATUT[s.statut])s.statut='B';
  s.type=TYPES[s.type]?s.type:(OLD_TYPE[s.type]||'Zp');
  s.grade=s.grade||'';
  if(s.points===undefined)s.points=null;
  return s;
}
/* Doplní chybějící pole jednoho studia (mění objekt na místě). */
function normStudy(st){
  var base=emptyStudy(st.id,st.level);
  Object.keys(base).forEach(function(k){if(st[k]==null)st[k]=base[k];});
  if(!LEVELS[st.level])st.level=LEVELS[st.id]?st.id:'other';
  ['subjects','sessions','milestones','blocks','aprobs'].forEach(function(k){st[k]=Array.isArray(st[k])?st[k]:[];});
  var th=st.thesis||{},tb=emptyThesis();
  Object.keys(tb).forEach(function(k){if(th[k]==null)th[k]=tb[k];});
  th.dates=Object.assign({assign:'',submit:'',exam:'',defense:''},th.dates||{});
  ['tasks','chapters','consultations'].forEach(function(k){th[k]=Array.isArray(th[k])?th[k]:[];});
  th.tasks.forEach(function(r){if(r.note==null)r.note='';});
  st.thesis=th;
  st.subjects.forEach(fixSubject);
  return st;
}

/* ---------- ukládání (do dat uživatele ve Stickies) ---------- */
function setStatus(t){var el=$('#status');if(el)el.textContent=t;}
function stable(){return JSON.stringify(S.studies);}
function save(){setStatus('Ukládám…');clearTimeout(saveTimer);saveTimer=setTimeout(doSave,300);}
function doSave(){
  saveTimer=null;
  if(HOST){HOST.setStudies(S.studies);HOST.setActive(S.active);snap=stable();setStatus('Uloženo');}
  else setStatus('Aplikace běží mimo Stickies, nic se neukládá.');
}
function loadFromHost(){
  var list=HOST?HOST.getStudies():[];
  list.forEach(normStudy);
  if(HOST)HOST.mark(list);
  var act=HOST?HOST.getActive():'';
  S={v:3,active:list.some(function(x){return x.id===act;})?act:(list[0]?list[0].id:''),studies:list};
  snap=stable();
}

/* ---------- modaly ---------- */
function closeModal(){$('#modal-root').innerHTML='';document.removeEventListener('keydown',escKey);}
function escKey(e){if(e.key==='Escape')closeModal();}
function fieldHTML(f,v){
  var id='f-'+f.name,val=(v!==undefined?v:f.value);if(val==null)val='';
  var inner='';
  if(f.type==='select'){
    inner='<label for="'+id+'">'+esc(f.label)+'</label><select id="'+id+'" name="'+f.name+'">'+f.options.map(function(o){return '<option value="'+esc(o[0])+'"'+(String(o[0])===String(val)?' selected':'')+'>'+esc(o[1])+'</option>';}).join('')+'</select>';
  }else if(f.type==='textarea'){
    inner='<label for="'+id+'">'+esc(f.label)+'</label><textarea id="'+id+'" name="'+f.name+'">'+esc(val)+'</textarea>';
  }else if(f.type==='checks'){
    return '<fieldset class="fld"><legend>'+esc(f.label)+'</legend>'+f.options.map(function(o,i){return '<label class="chk" for="'+id+i+'"><input type="checkbox" id="'+id+i+'" name="'+f.name+'" value="'+esc(o[0])+'"'+((val||[]).indexOf(o[0])>-1?' checked':'')+'> '+esc(o[1])+'</label>';}).join('')+'</fieldset>';
  }else{
    inner='<label for="'+id+'">'+esc(f.label)+'</label><input id="'+id+'" name="'+f.name+'" type="'+(f.type||'text')+'" value="'+esc(val)+'"'+(f.required?' required':'')+(f.min!=null?' min="'+f.min+'"':'')+(f.step?' step="'+f.step+'"':'')+'>';
  }
  return '<div class="fld">'+inner+'</div>';
}
function openForm(o){
  var vals=o.values||{};
  var html='<div class="scrim" data-scrim="1"><form class="modal" id="mform" role="dialog" aria-modal="true" aria-label="'+esc(o.title)+'"><h3>'+esc(o.title)+'</h3>'+
    (o.intro?'<p class="muted">'+esc(o.intro)+'</p>':'')+
    o.fields.map(function(f){return fieldHTML(f,vals[f.name]);}).join('')+
    '<div class="btns"><button type="button" class="btn" data-act="close">Zrušit</button><button type="submit" class="btn primary">'+esc(o.submit||'Uložit')+'</button></div></form></div>';
  $('#modal-root').innerHTML=html;
  document.addEventListener('keydown',escKey);
  var form=$('#mform');
  var first=form.querySelector('input[type=text],input[type=number],input[type=date],select,textarea');if(first)first.focus();
  form.addEventListener('submit',function(ev){
    ev.preventDefault();
    var fd=new FormData(form),out={};
    o.fields.forEach(function(f){out[f.name]=f.type==='checks'?fd.getAll(f.name):fd.get(f.name);});
    closeModal();o.onSave(out);
  });
}
function confirmBox(msg,label,fn){
  $('#modal-root').innerHTML='<div class="scrim" data-scrim="1"><div class="modal" role="dialog" aria-modal="true"><h3>Opravdu?</h3><p>'+esc(msg)+'</p><div class="btns"><button class="btn" data-act="close" type="button">Zrušit</button><button class="btn danger" id="conf-ok" type="button">'+esc(label)+'</button></div></div></div>';
  document.addEventListener('keydown',escKey);
  $('#conf-ok').addEventListener('click',function(){closeModal();fn();});
}
function subjOptions(){
  var ct=tkey(curTerm());
  return D.subjects.slice().sort(function(a,b){
    var ca=tkey(a)===ct?0:1,cb=tkey(b)===ct?0:1;if(ca!==cb)return ca-cb;
    var t=tsort(tkey(b),tkey(a));return t||(a.name<b.name?-1:1);
  }).map(function(s){return [s.id,(s.code?s.code+' – ':'')+s.name];});
}
function num0(v){return v===''||v==null?null:(Number(v)||0);}

/* ---------- formuláře ---------- */
function subjectForm(id){
  var s=id?subj(id):null,ct=curTerm();
  openForm({title:s?'Upravit předmět':'Nový předmět',
    intro:s?'':'Pokud ještě nemá výsledek, nabídnou se podle způsobu ukončení typické podmínky.',
    fields:[
      {name:'name',label:'Název předmětu',required:true},
      {name:'code',label:'Zkratka předmětu (např. ABC/XYZ)'},
      {name:'year',label:'Akademický rok (např. 26/27)'},
      {name:'sem',label:'Semestr',type:'select',options:[['ZS','Zimní (ZS)'],['LS','Letní (LS)']]},
      {name:'credits',label:'Kredity',type:'number',min:0,step:1},
      {name:'statut',label:'Statut',type:'select',options:Object.keys(STATUT).map(function(k){return [k,k+' – '+STATUT[k]];})},
      {name:'type',label:'Způsob ukončení',type:'select',options:Object.keys(TYPES).map(function(k){return [k,TYPES[k]];})},
      {name:'grade',label:'Výsledek',type:'select',options:GRADES},
      {name:'gdate',label:'Datum výsledku',type:'date'}
    ],
    values:s?{name:s.name,code:s.code,year:s.year,sem:s.sem,credits:s.credits,statut:s.statut,type:s.type,grade:s.grade,gdate:s.gdate}:{name:'',code:'',year:ct.year,sem:ct.sem,credits:3,statut:'A',type:'Zk',grade:'',gdate:''},
    onSave:function(v){
      var o={name:v.name.trim(),code:v.code.trim(),year:v.year.trim(),sem:v.sem,credits:Number(v.credits)||0,statut:v.statut,type:v.type,grade:v.grade,gdate:v.gdate||''};
      if(s){Object.keys(o).forEach(function(k){s[k]=o[k];});}
      else{o.id=uid();o.hours='';o.zdate='';o.points=null;o.rel='';
        o.reqs=o.grade?[]:(TEMPLATES[o.type]||[]).map(function(t){return {id:uid(),title:t[0],weight:t[1],due:'',done:false,doneAt:''};});
        D.subjects.push(o);}
      changed();
    }});
}
function reqForm(sid,rid,pickSubject){
  var s=sid?subj(sid):null,r=(s&&rid)?s.reqs.filter(function(x){return x.id===rid;})[0]:null;
  var fields=[];
  if(pickSubject){
    var opts=D.subjects.filter(function(q){return !passed(q);}).map(function(q){return [q.id,(q.code?q.code+' – ':'')+q.name];});
    if(D.hasThesis)opts.push(['thesis:'+D.id,thesisSubj().name]);
    fields.push({name:'subject',label:'Předmět nebo práce',type:'select',options:opts});
  }
  fields.push({name:'title',label:'Co je potřeba splnit',required:true},{name:'due',label:'Termín',type:'date'},
    {name:'weight',label:'Váha pro procenta',type:'select',options:[[1,'Malá (1)'],[2,'Střední (2)'],[3,'Velká (3)']]},
    {name:'note',label:'Podrobnosti zadání (volitelné)',type:'textarea'});
  openForm({title:r?'Upravit podmínku':(pickSubject?'Nový deadline':'Nová podmínka'),fields:fields,
    values:r?{title:r.title,due:r.due,weight:r.weight,note:r.note||''}:{title:'',due:'',weight:1,note:''},
    onSave:function(v){
      if(r){r.title=v.title.trim();r.due=v.due||'';r.weight=Number(v.weight)||1;r.note=v.note||'';}
      else{var t=pickSubject?subj(v.subject):s;if(!t)return;t.reqs.push({id:uid(),title:v.title.trim(),weight:Number(v.weight)||1,due:v.due||'',done:false,doneAt:'',note:v.note||''});}
      changed();
    }});
}
function sessionForm(id){
  var x=id?D.sessions.filter(function(q){return q.id===id;})[0]:null,opts=subjOptions();
  openForm({title:x?'Upravit zápis':'Nový zápis z výuky',
    fields:[
      {name:'subjectId',label:'Předmět',type:'select',options:opts},
      {name:'date',label:'Datum',type:'date',required:true},
      {name:'kind',label:'Druh výuky',type:'select',options:Object.keys(KINDS).map(function(k){return [k,KINDS[k]];})},
      {name:'topic',label:'Téma',required:true},
      {name:'note',label:'Poznámky',type:'textarea'}
    ],
    values:x?{subjectId:x.subjectId,date:x.date,kind:x.kind,topic:x.topic,note:x.note}:{subjectId:filterSubj||(opts[0]&&opts[0][0]),date:today(),kind:'prednaska',topic:'',note:''},
    onSave:function(v){
      if(x){x.subjectId=v.subjectId;x.date=v.date;x.kind=v.kind;x.topic=v.topic.trim();x.note=v.note;}
      else{D.sessions.push({id:uid(),subjectId:v.subjectId,date:v.date,kind:v.kind,topic:v.topic.trim(),note:v.note,attended:null});}
      changed();
    }});
}
function catOptions(){
  var c=HOST&&HOST.getCategories?HOST.getCategories():[];
  return [['','Nepřenášet do úkolů']].concat(c.map(function(x){return [x.id,x.name];}));
}
var MODES=[['due','Jen podmínky s termínem'],['all','Všechny nesplněné podmínky']];
function catName(id){var c=(HOST&&HOST.getCategories?HOST.getCategories():[]).filter(function(x){return x.id===id;})[0];return c?c.name:'';}
function shiftTerm(t,k){
  var idx=(2000+parseInt(t.year.slice(0,2),10))*2+(t.sem==='LS'?1:0)+k,y=Math.floor(idx/2),sem=idx%2?'LS':'ZS';
  return {year:pad(y%100)+'/'+pad((y+1)%100),sem:sem};
}
function parseBulk(text,term,type,statut){
  var out=[];
  text.split(/\r?\n/).forEach(function(line){
    line=line.trim();if(!line)return;
    var code='',m=line.match(/^([A-Za-zÁ-Žá-ž0-9]{2,8}\/[A-Za-zÁ-Žá-ž0-9]{2,12})\s*[-–|,;:]?\s*/);
    if(m){code=m[1].toUpperCase();line=line.slice(m[0].length);}
    var kr=null,km=line.match(/[\s,;|-]+(\d{1,2})\s*(?:kr\.?|kred\w*)?\s*$/i);
    if(km){kr=Number(km[1]);line=line.slice(0,km.index);}
    line=line.replace(/[\s,;|-]+$/,'').trim();
    if(!line)return;
    out.push(fixSubject({id:uid(),code:code,name:line,year:term.year,sem:term.sem,credits:kr||0,hours:'',statut:statut,type:type,grade:'',gdate:'',zdate:'',points:null,rel:'',reqs:[]}));
  });
  return out;
}
function bulkForm(){
  var ct=curTerm(),opts=[-1,0,1].map(function(k){var t=shiftTerm(ct,k);return [t.year+' '+t.sem,tlabel(t.year+' '+t.sem)+(k===0?' (teď)':'')];});
  openForm({title:'Vložit víc předmětů najednou',intro:'Každý předmět na jeden řádek. Zkratka na začátku a kredity na konci jsou volitelné, třeba „KAG/DMAA Deskriptivní geometrie 4“. Doplníš a upravíš je pak u každého předmětu.',
    fields:[
      {name:'text',label:'Předměty (jeden na řádek)',type:'textarea'},
      {name:'term',label:'Semestr',type:'select',options:opts},
      {name:'type',label:'Způsob ukončení (výchozí)',type:'select',options:Object.keys(TYPES).map(function(k){return [k,TYPES[k]];})},
      {name:'statut',label:'Statut (výchozí)',type:'select',options:Object.keys(STATUT).map(function(k){return [k,k+' – '+STATUT[k]];})}],
    values:{text:'',term:opts[1][0],type:'Zk',statut:'B'},
    onSave:function(v){
      var p=v.term.split(' '),list=parseBulk(v.text,{year:p[0],sem:p[1]},v.type,v.statut);
      if(!list.length){toast('Nenašla jsem žádný řádek s názvem předmětu.');return;}
      list.forEach(function(x){D.subjects.push(x);});
      changed();toast('Přidáno předmětů: '+list.length+'.');
    }});
}
function newStudyForm(){
  openForm({title:'Nové studium',intro:'Po vytvoření přidej předměty, bloky plánu a případně závěrečnou práci. Hotové studium jde také načíst ze zálohy v Nastavení.',fields:[
    {name:'level',label:'Typ studia',type:'select',options:Object.keys(LEVELS).map(function(k){return [k,LEVELS[k]];})},
    {name:'name',label:'Název studia',required:true},
    {name:'programme',label:'Obor (volitelné)'},
    {name:'faculty',label:'Fakulta (volitelné)'},
    {name:'category_id',label:'Seznam úkolů ve Stickies, kam se přenášejí podmínky',type:'select',options:catOptions()},
    {name:'taskMode',label:'Co přenášet',type:'select',options:MODES}],
    values:{level:'bc',name:LEVELS.bc,programme:'',faculty:'',category_id:'',taskMode:'due'},
    onSave:function(v){var st=emptyStudy(uid(),v.level);st.name=v.name.trim();st.programme=v.programme.trim();st.faculty=v.faculty.trim();st.category_id=v.category_id||'';st.taskMode=v.taskMode==='all'?'all':'due';
      S.studies.push(st);S.active=st.id;filterSubj='';changed();}});
}
function studyForm(){
  openForm({title:'Údaje o studiu',fields:[
    {name:'name',label:'Název studia',required:true},
    {name:'programme',label:'Obor'},
    {name:'faculty',label:'Fakulta'},
    {name:'form',label:'Forma studia (prezenční, kombinované)'},
    {name:'minCredits',label:'Minimum kreditů ke studiu',type:'number',min:0,step:1},
    {name:'yearsStd',label:'Standardní délka (roky)',type:'number',min:0,step:1},
    {name:'yearsMax',label:'Maximální délka (roky)',type:'number',min:0,step:1},
    {name:'yearsEnrolled',label:'Zapsáno (roky, např. 1,2)'},
    {name:'yearsLeft',label:'Zbývá nejvýše (roky, např. 4,8)'},
    {name:'stagAvg',label:'Průměr uvedený ve STAGu'},
    {name:'stagDate',label:'Datum posledního výpisu ze STAGu',type:'date'},
    {name:'hasThesis',label:'Závěrečná práce',type:'select',options:[['1','Studium má závěrečnou práci'],['0','Bez závěrečné práce']]},
    {name:'category_id',label:'Seznam úkolů ve Stickies, kam se přenášejí podmínky',type:'select',options:catOptions()},
    {name:'taskMode',label:'Co přenášet do seznamu',type:'select',options:MODES}],
    values:{name:D.name,programme:D.programme,faculty:D.faculty,form:D.form,minCredits:D.minCredits,yearsStd:D.yearsStd,yearsMax:D.yearsMax,yearsEnrolled:D.yearsEnrolled,yearsLeft:D.yearsLeft,stagAvg:D.stagAvg,stagDate:D.stagDate,hasThesis:D.hasThesis?'1':'0',category_id:D.category_id||'',taskMode:D.taskMode||'due'},
    onSave:function(v){D.name=v.name.trim();D.programme=v.programme.trim();D.faculty=v.faculty.trim();D.form=v.form.trim();D.minCredits=Number(v.minCredits)||0;
      D.yearsStd=Number(v.yearsStd)||0;D.yearsMax=Number(v.yearsMax)||0;D.yearsEnrolled=v.yearsEnrolled.trim();D.yearsLeft=v.yearsLeft.trim();D.stagAvg=v.stagAvg.trim();D.stagDate=v.stagDate||'';D.hasThesis=v.hasThesis==='1';D.category_id=v.category_id||'';D.taskMode=v.taskMode==='all'?'all':'due';changed();}});
}
function thesisForm(){
  var t=D.thesis;
  openForm({title:'Údaje o práci',fields:[
    {name:'title',label:'Název práce'},{name:'supervisor',label:'Vedoucí práce'},{name:'department',label:'Pracoviště'},
    {name:'targetPages',label:'Cílový rozsah (stran)',type:'number',min:0,step:1},
    {name:'assign',label:'Zadání schváleno',type:'date'},{name:'submit',label:'Odevzdání práce',type:'date'},
    {name:'exam',label:'Státní závěrečná zkouška',type:'date'},{name:'defense',label:'Obhajoba',type:'date'}],
    values:{title:t.title,supervisor:t.supervisor,department:t.department,targetPages:t.targetPages,assign:t.dates.assign,submit:t.dates.submit,exam:t.dates.exam,defense:t.dates.defense},
    onSave:function(v){t.title=v.title.trim();t.supervisor=v.supervisor.trim();t.department=v.department.trim();t.targetPages=Number(v.targetPages)||0;
      t.dates={assign:v.assign||'',submit:v.submit||'',exam:v.exam||'',defense:v.defense||''};changed();}});
}
function chapterForm(id){
  var c=id?D.thesis.chapters.filter(function(x){return x.id===id;})[0]:null;
  openForm({title:c?'Upravit kapitolu':'Nová kapitola',fields:[
    {name:'title',label:'Název kapitoly',required:true},
    {name:'status',label:'Stav',type:'select',options:[['todo','Nezačato'],['wip','Rozpracováno'],['done','Hotovo']]},
    {name:'pages',label:'Počet stran',type:'number',min:0,step:1}],
    values:c?{title:c.title,status:c.status,pages:c.pages}:{title:'',status:'todo',pages:0},
    onSave:function(v){if(c){c.title=v.title.trim();c.status=v.status;c.pages=Number(v.pages)||0;}else{D.thesis.chapters.push({id:uid(),title:v.title.trim(),status:v.status,pages:Number(v.pages)||0});}changed();}});
}
function consForm(id){
  var c=id?D.thesis.consultations.filter(function(x){return x.id===id;})[0]:null;
  openForm({title:c?'Upravit konzultaci':'Nová konzultace',fields:[
    {name:'date',label:'Datum',type:'date',required:true},{name:'note',label:'Co jsme řešili a co mám udělat',type:'textarea'}],
    values:c?{date:c.date,note:c.note}:{date:today(),note:''},
    onSave:function(v){if(c){c.date=v.date;c.note=v.note;}else{D.thesis.consultations.push({id:uid(),date:v.date,note:v.note});}changed();}});
}
function download(name,text,msg){
  try{var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.download=name;document.body.appendChild(a);a.click();a.remove();}
  catch(e){msg('Stažení se nepovedlo. Použij kopírování.');}
}
function settings(){
  $('#modal-root').innerHTML='<div class="scrim" data-scrim="1"><div class="modal" role="dialog" aria-modal="true" aria-label="Nastavení"><h3>Nastavení a záloha</h3>'+
  '<p class="muted">Záloha obsahuje všechna studia, tedy i známky. Ukládej ji na bezpečné místo, ne do veřejného repozitáře. Studia se jinak ukládají spolu s úkoly, na GitHub do tvého souboru.</p>'+
  '<div class="btns" style="justify-content:flex-start">'+'<button class="btn" id="bk-dl" type="button">Stáhnout zálohu (.json)</button>'+'<button class="btn" id="bk-copy" type="button">Kopírovat zálohu</button></div>'+
  '<div class="fld"><label for="bk-file">Načíst zálohu ze souboru</label><input id="bk-file" type="file" accept=".json,application/json"></div>'+
  '<div class="fld"><label for="bk-text">Nebo vlož zálohu jako text</label><textarea id="bk-text" placeholder="Sem vlož zálohu a stiskni Načíst."></textarea></div>'+
  '<div class="btns" style="justify-content:flex-start"><button class="btn" id="bk-load" type="button">Načíst zálohu</button><button class="btn danger" id="bk-wipe" type="button">Smazat všechna studia</button></div>'+
  '<p id="bk-msg" class="muted" role="status"></p>'+
  '<div class="btns"><button class="btn primary" data-act="close" type="button">Hotovo</button></div></div></div>';
  document.addEventListener('keydown',escKey);
  var msg=function(t){$('#bk-msg').textContent=t;};
  function load(text){
    var x;try{x=JSON.parse(text);if(!x||!Array.isArray(x.studies)||!x.studies.length)throw 0;}catch(e){msg('Tohle není platná záloha studia. Zkontroluj, že je celá.');return;}
    var inc=x.studies.filter(function(q){return q&&q.id;}).map(function(q){return normStudy(q);});
    var clash=inc.filter(function(q){return S.studies.some(function(o){return o.id===q.id;});}).length;
    function go(){inc.forEach(function(q){delete q.updated_at;delete q.deleted;var i=S.studies.map(function(o){return o.id;}).indexOf(q.id);if(i>-1)S.studies[i]=q;else S.studies.push(q);});
      if(!S.studies.some(function(o){return o.id===S.active;}))S.active=S.studies[0].id;changed();}
    if(clash)confirmBox('Studia se stejným označením ('+clash+') se přepíšou zálohou.','Načíst zálohu',go);else{closeModal();go();}
  }
  $('#bk-dl').addEventListener('click',function(){download('studijni-index-zaloha-'+today()+'.json',backupText(true),msg);msg('Záloha se stahuje.');});
  $('#bk-copy').addEventListener('click',function(){
    var t=backupText(false);$('#bk-text').value=t;
    try{navigator.clipboard.writeText(t).then(function(){msg('Záloha je zkopírovaná.');},function(){msg('Kopírování se nepovedlo. Text výše si zkopíruj ručně.');});}
    catch(e){msg('Kopírování se nepovedlo. Text výše si zkopíruj ručně.');}
  });
  $('#bk-file').addEventListener('change',function(e){
    var f=e.target.files&&e.target.files[0];if(!f)return;
    var r=new FileReader();r.onload=function(){load(String(r.result));};r.onerror=function(){msg('Soubor se nepodařilo přečíst.');};r.readAsText(f);
  });
  $('#bk-load').addEventListener('click',function(){load($('#bk-text').value);});
  $('#bk-wipe').addEventListener('click',function(){confirmBox('Smažou se všechna studia: předměty, zápisy i údaje o práci. Úkoly zůstanou. Nejde to vrátit.','Smazat vše',function(){S.studies.length=0;S.active='';D=null;changed();});});
}
function backupText(pretty){
  var o={app:'studijni-index',v:3,saved_at:new Date().toISOString(),studies:JSON.parse(JSON.stringify(S.studies))};
  o.studies.forEach(function(q){delete q.updated_at;delete q.deleted;});
  return JSON.stringify(o,null,pretty?1:0);
}
function changed(){save();render();}

/* ---------- vykreslení ---------- */
function chip(s){return s?'<span class="chip" style="--c:'+col(s)+'"><i></i>'+esc(s.name)+'</span>':'';}
function gradeHTML(s){
  if(!s.grade)return '';
  var c=s.grade==='S'?'g-s':('AB'.indexOf(s.grade)>-1?'g-good':('CD'.indexOf(s.grade)>-1?'g-mid':'g-low'));
  return '<span class="grade '+c+'" title="'+(s.grade==='S'?'Splněno':'Známka '+s.grade)+'">'+s.grade+'</span>';
}
function addDays(n){var d=new Date();d.setDate(d.getDate()+n);return ymd(d);}
function nextFri(){var d=new Date(),k=(5-d.getDay()+7)%7;return addDays(k===0?7:k);}
function relSoft(s){var d=diff(s);if(d<0)return d===-1?'od včera':'už '+(-d)+' '+dny(d);if(d===0)return 'dnes';if(d===1)return 'zítra';return 'za '+d+' '+dny(d);}
function dueHTML(r){
  if(!r.due)return '';
  var d=diff(r.due),cls=r.done?'ok':(d<0?'wait':(d<=3?'soon':''));
  return '<span class="due '+cls+'">'+fmt(r.due)+(r.done?'':' · '+relSoft(r.due))+'</span>';
}
function tstate(r){return (HOST&&HOST.taskState&&r.tid)?HOST.taskState(r.tid):'';}
function toast(msg,undo){
  var el=$('#toast');if(!el)return;
  el.innerHTML='<span>'+esc(msg)+'</span>'+(undo?'<button type="button" data-act="toast-undo">Zpět</button>':'');
  el.hidden=false;ui.undo=undo||null;clearTimeout(ui.tt);ui.tt=setTimeout(function(){el.hidden=true;ui.undo=null;},7000);
}
function setDone(sid,rid,val){
  var s=subj(sid),r=s&&s.reqs.filter(function(q){return q.id===rid;})[0];if(!r)return;
  var was=r.done,wasAt=r.doneAt;r.done=val;r.doneAt=val?today():'';changed();
  toast(val?PRAISE[Math.floor(Math.random()*PRAISE.length)]:'Vráceno mezi otevřené.',function(){r.done=was;r.doneAt=wasAt;changed();});
}
function setDue(sid,rid,v){
  var s=subj(sid),r=s&&s.reqs.filter(function(q){return q.id===rid;})[0];if(!r)return;
  var old=r.due;r.due=v==='none'?'':addDays(Number(v));changed();
  toast(r.due?'Termín: '+fmt(r.due).replace(/\.$/,'')+'.':'Termín odebrán.',function(){r.due=old;changed();});
}
function menuHTML(s,r){
  var ts=tstate(r),a=' data-s="'+s.id+'" data-r="'+r.id+'"';
  return '<details class="more"><summary aria-label="Další akce" title="Další akce">⋯</summary><div class="menu">'+
   (ts==='backlog'?'<button type="button" data-act="totoday" data-id="'+r.tid+'">Přidat na dnes</button>':'')+
   '<button type="button" data-act="due"'+a+' data-v="0">Termín: dnes</button><button type="button" data-act="due"'+a+' data-v="1">Termín: zítra</button><button type="button" data-act="due"'+a+' data-v="7">Termín: za týden</button>'+
   (r.due?'<button type="button" data-act="due"'+a+' data-v="none">Bez termínu</button>':'')+
   '<button type="button" data-act="edit-req"'+a+'>Upravit</button><button type="button" class="bad" data-act="del-req"'+a+'>Smazat</button></div></details>';
}
function linkify(t){return esc(t).replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>');}
function reqRow(s,r,showSubj){
  var ts=tstate(r),can=ts==='today'||ts==='backlog';
  return '<li class="row'+(r.done?' done':'')+'"><label class="cb"><input type="checkbox" data-change="toggle" data-s="'+s.id+'" data-r="'+r.id+'"'+(r.done?' checked':'')+' aria-label="Splněno: '+esc(r.title)+'"><span class="bx" aria-hidden="true"></span></label>'+
   '<div class="main"><div class="t">'+esc(r.title)+'</div><div class="meta">'+(showSubj?chip(s):'')+dueHTML(r)+(ts==='today'?'<span class="chip lk">dnes ve Stickies</span>':'')+'</div>'+
   (r.note?'<details class="rd"><summary>Podrobnosti</summary><div class="rnote">'+linkify(r.note)+'</div></details>':'')+'</div>'+
   '<div class="tools">'+menuHTML(s,r)+'</div></li>';
}
function noSubjects(){return onboardingCard()+valueProps();}
function dd(v){return v?fmt(v)+' · <span class="muted">'+rel(v)+'</span>':'<span class="muted">nezadáno</span>';}
function meter(label,val,pct){return '<div class="meter"><div class="l"><span>'+label+'</span><b>'+val+'</b></div><div class="bar" role="img" aria-label="'+pct+' %"><i style="width:'+pct+'%"></i></div></div>';}
function studyLine(){
  var p=[];if(D.programme)p.push(esc(D.programme));if(D.form)p.push(esc(D.form)+' studium');if(D.faculty)p.push(esc(D.faculty));
  return p.length?'<p class="studyline">'+p.join(' · ')+'</p>':'';
}
function onboardingCard(){
  var hasReq=D.subjects.some(function(q){return q.reqs.length;})||D.thesis.tasks.length;
  var steps=[
    ['Studium je vytvořené',true,''],
    ['Přidej předměty',D.subjects.length>0,'<button class="btn small primary" data-act="bulk-subj" type="button">Vložit víc najednou</button> <button class="btn small" data-act="add-subj" type="button">Jeden předmět</button>'],
    ['Přidej první podmínku s termínem',!!hasReq&&dueList().length>0,'<button class="btn small" data-act="go" data-id="deadliny" type="button">Přidat termín</button>'],
    ['Vyber seznam ve Stickies pro úkoly',!!D.category_id,'<button class="btn small" data-act="edit-study" type="button">Vybrat seznam</button>']
  ];
  var done=steps.filter(function(x){return x[1];}).length;
  if(done===steps.length)return '';
  var next=true;
  return '<section class="card onb"><div class="head-row"><div><p class="eyebrow">Začínáme</p><h2>Nastav si studium za pár minut</h2></div><span class="count">'+done+' z '+steps.length+'</span></div>'+
   '<ol class="onb-list">'+steps.map(function(x){var cur=!x[1]&&next;if(!x[1])next=false;return '<li class="'+(x[1]?'ok':(cur?'cur':''))+'"><span class="mk" aria-hidden="true">'+(x[1]?'✓':'')+'</span><div><div>'+x[0]+'</div>'+(x[1]||!cur?'':'<div class="act">'+x[2]+'</div>')+'</div></li>';}).join('')+'</ol></section>';
}
function thesisCard(){
  var t=D.thesis,p=prog(thesisSubj()),pg=chPages(),tp=Number(t.targetPages)||0;
  return '<section class="card"><div class="head-row"><h3>'+thesisLabel()+'</h3><a class="link" href="#prace" data-act="go" data-id="prace">Otevřít stránku práce</a></div>'+
   (t.title?'<p style="margin:6px 0 12px">'+esc(t.title)+'</p>':'<p class="muted" style="margin:6px 0 12px">Zatím bez názvu.</p>')+
   meter('Etapy práce',p+' %',p)+
   '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:14px"><span>Odevzdání: '+dd(t.dates.submit)+'</span><span>Napsáno '+pg+(tp?' z '+tp:'')+' stran</span></div></section>';
}

function progressCard(){
  var pct=overallPct(),ct=curTerm(),left=Math.max(0,creditsMin()-creditsEarned());
  var termSubs=D.subjects.filter(function(q){return inTerm(q,ct);});
  var termPlan=termSubs.reduce(function(a,q){return a+q.credits;},0),termDone=termSubs.reduce(function(a,q){return a+(passed(q)?q.credits:0);},0);
  var wins=winsCount();
  return '<section class="card"><div class="head-row"><h3>'+(pct>=100?'Kredity jsou splněné':'Splněno '+pct+' %')+'</h3></div>'+
   '<div class="bar" style="margin:10px 0" role="img" aria-label="'+pct+' %"><i style="width:'+pct+'%"></i></div>'+
   '<p class="soft">'+(left?'Do cíle zbývá '+left+' '+plural(left,'kredit','kredity','kreditů')+'.':'Všechny kredity máš. Zbývá dokončit státnice a práci.')+'</p>'+
   foldLink('cisla','Podrobná čísla')+(ui.fold.cisla?'<div class="tiles"><div class="tile"><b>'+creditsEarned()+' / '+creditsMin()+'</b><span>získaných kreditů</span></div>'+
   '<div class="tile"><b>'+avgStr(D.subjects)+'</b><span>vážený průměr A–F</span>'+(D.stagAvg?'<small>STAG uvádí '+esc(D.stagAvg)+(D.stagDate?' k '+fmtShort(D.stagDate):'')+'</small>':'')+'</div>'+
   '<div class="tile"><b>'+termDone+' / '+termPlan+'</b><span>kreditů v '+tlabel(ct.year+' '+ct.sem)+'</span></div>'+
   '<div class="tile win"><b>'+wins+'</b><span>'+plural(wins,'splněná věc','splněné věci','splněných věcí')+' za 7 dní</span></div></div>':'')+'</section>';
}
function pickNow(){
  var open=dueList(),up=open.filter(function(x){return diff(x.r.due)>=0;}),ov=open.filter(function(x){return diff(x.r.due)<0;});
  var res={x:null,up:up,ov:ov};
  if(up.length&&diff(up[0].r.due)<=3)res.x=up[0];
  else if(ov.length)res.x=ov[ov.length-1];
  else if(up.length)res.x=up[0];
  else{var ct=curTerm(),nd=allReqs().filter(function(q){return !q.r.due&&!q.r.done&&!passed(q.s)&&(q.s.thesis||inTerm(q.s,ct));});if(nd.length)res.x=nd[0];}
  return res;
}
function nowCard(p){
  if(!p.x){var none=!allReqs().some(function(q){return !q.r.done;});
    return '<section class="card now calm"><p class="eyebrow">Teď</p><h2>'+(none?'Zatím bez termínů':'Nic nehoří')+'</h2><p class="muted">'+(none?'Přidej první podmínku s termínem a ukážu ti, co je potřeba udělat jako první.':'Žádná otevřená podmínka. Využij klid: dopiš si zápisy z hodin, nebo si přidej další termín.')+'</p><div class="btns" style="justify-content:flex-start;margin-top:12px"><button class="btn" data-act="go" data-id="zapisy" type="button">Zápisy z výuky</button><button class="btn" data-act="go" data-id="deadliny" type="button">Přidat termín</button></div></section>';}
  var x=p.x,r=x.r,s=x.s,ts=tstate(r),can=ts==='today'||ts==='backlog',a=' data-s="'+s.id+'" data-r="'+r.id+'"';
  var d=r.due?diff(r.due):null;
  var lead=d==null?'Bez termínu, ale patří do tohoto semestru':(d<0?'Tohle čeká nejdéle. Stačí začít, i kdyby na pět minut.':(d===0?'Termín je dnes':(d<=3?'Termín se blíží':'Nejbližší na řadě')));
  return '<section class="card now"><p class="eyebrow">Teď stačí tohle jedno</p><h2>'+esc(r.title)+'</h2><div class="meta">'+chip(s)+dueHTML(r)+'</div><p class="lead">'+lead+'</p>'+
   '<div class="now-actions"><button class="btn primary big" type="button" data-act="done"'+a+'>✓ Hotovo</button>'+
   '<details class="more"><summary class="btn big">Až jindy</summary><div class="menu"><button type="button" data-act="due"'+a+' data-v="1">Zítra</button><button type="button" data-act="due"'+a+' data-v="7">Za týden</button>'+(r.due?'<button type="button" data-act="due"'+a+' data-v="none">Bez termínu</button>':'')+'<button type="button" data-act="edit-req"'+a+'>Upravit podmínku</button></div></details></div>'+
   (r.note?'<details class="rd"><summary>Podrobnosti zadání</summary><div class="rnote">'+linkify(r.note)+'</div></details>':'')+'</section>';
}
function weekCard(){
  var now=new Date(),dow=(now.getDay()+6)%7,st=new Date(now);st.setDate(now.getDate()-dow);
  var open=allReqs().filter(function(q){return q.r.due&&!q.r.done&&!passed(q.s);}),cells='',nd=0,ns=0;
  for(var i=0;i<7;i++){
    var dt=new Date(st);dt.setDate(st.getDate()+i);var k=ymd(dt);
    var dues=open.filter(function(q){return q.r.due===k;}),ses=D.sessions.filter(function(q){return q.date===k;});
    nd+=dues.length;ns+=ses.length;
    var dots='',tot=dues.length+ses.length;
    for(var j=0;j<Math.min(tot,3);j++)dots+='<i class="'+(j<dues.length?'dd':'ds')+'"></i>';
    var tip=dues.map(function(q){return q.r.title;}).concat(ses.map(function(q){return KINDS[q.kind]+': '+q.topic;})).join('\n');
    cells+='<div class="wk-day'+(k===today()?' today':'')+(tot?' has':'')+'"'+(tip?' title="'+esc(tip)+'"':'')+'><span class="dn">'+DAYS[dt.getDay()]+'</span><b>'+dt.getDate()+'</b><span class="dots">'+dots+(tot>3?'<em>+'+(tot-3)+'</em>':'')+'</span></div>';
  }
  var txt=(nd||ns)?'Tento týden: '+nd+' '+plural(nd,'termín','termíny','termínů')+(ns?' a '+ns+' '+plural(ns,'hodina','hodiny','hodin')+' výuky':''):'Tento týden nemáš nic naplánováno.';
  return '<section class="card week"><div class="head-row"><h3>Tento týden</h3><span class="muted">'+txt+'</span></div><div class="wk">'+cells+'</div><div class="legend" style="margin-top:8px"><span><i class="ld dd"></i>termín</span><span><i class="ld ds"></i>výuka</span></div></section>';
}
function weekSummary(){
  var now=new Date(),dow=(now.getDay()+6)%7,st=new Date(now);st.setDate(now.getDate()-dow);
  var open=allReqs().filter(function(q){return q.r.due&&!q.r.done&&!passed(q.s);}),n=0;
  for(var i=0;i<7;i++){var dt=new Date(st);dt.setDate(st.getDate()+i);var k=ymd(dt);n+=open.filter(function(q){return q.r.due===k;}).length+D.sessions.filter(function(q){return q.date===k;}).length;}
  return n?n+' '+plural(n,'věc','věci','věcí'):'nic naplánováno';
}
function plural(n,a,b,c){return n===1?a:(n>=2&&n<=4?b:c);}
function winsCount(){var from=addDays(-6);return allReqs().filter(function(q){return q.r.done&&q.r.doneAt&&q.r.doneAt>=from;}).length;}

/** Sbalitelný blok: v přehledu zůstane jen nadpis a jedna věta, detaily se otevřou na klepnutí. */
function foldLink(id,title,sum){
  var open=!!ui.fold[id];
  return '<button class="fold-head" type="button" data-act="tfold" data-id="'+id+'" aria-expanded="'+open+'"><b>'+title+'</b>'+(sum?'<span class="muted">'+sum+'</span>':'')+'<span class="chev" aria-hidden="true">›</span></button>';
}
function foldCard(id,title,sum,body){
  return '<section class="card fold'+(ui.fold[id]?' open':'')+'">'+foldLink(id,title,sum)+(ui.fold[id]?'<div class="fold-body">'+body+'</div>':'')+'</section>';
}

function viewOverview(){
  var h=studyLine();
  var onb=onboardingCard();
  if(!D.subjects.length)return h+onb+valueProps()+studyActions();
  var pct=overallPct(),ct=curTerm(),p=pickNow();
  var termSubs=D.subjects.filter(function(s){return inTerm(s,ct);});
  var termPlan=termSubs.reduce(function(a,s){return a+s.credits;},0),termDone=termSubs.reduce(function(a,s){return a+(passed(s)?s.credits:0);},0);
  var rest=p.up.filter(function(x){return x!==p.x;}).concat(p.ov.filter(function(x){return x!==p.x;}).reverse());
  var wins=winsCount(),waiting=p.ov.length;
  h+=nowCard(p)+progressCard()+onb;
  if(rest.length)h+='<section class="card"><div class="head-row"><h3>Dál na řadě</h3><a class="link" href="#" data-act="go" data-id="deadliny">Všechny termíny'+(rest.length>2?' ('+rest.length+')':'')+'</a></div><ul class="list">'+rest.slice(0,2).map(function(x){return reqRow(x.s,x.r,true);}).join('')+'</ul>'+
    (waiting?'<p class="soft">Čeká na dořešení: '+waiting+'. Nic se neděje, vybírej po jedné věci.</p>':'')+'</section>';
  h+=foldCard('tyden','Tento týden',weekSummary(),weekCard());
  h+=foldCard('predmety','Předměty v '+tlabel(ct.year+' '+ct.sem),termSubs.length+' '+plural(termSubs.length,'předmět','předměty','předmětů'),
   (termSubs.length?termSubs.map(function(s){var q=prog(s);return '<div class="minirow" style="--c:'+col(s)+'"><span class="nm">'+esc(s.name)+'</span><div class="bar" role="img" aria-label="'+q+' %"><i style="width:'+q+'%"></i></div><span class="p">'+(s.grade?gradeHTML(s):q+' %')+'</span></div>';}).join(''):'<p class="muted">V aktuálním semestru nemáš zapsané žádné předměty.</p>')+
   '<p style="margin-top:10px"><a class="link" href="#" data-act="go" data-id="predmety">Všechny předměty</a></p>');
  if(D.hasThesis)h+=foldCard('diplomka',thesisLabel(),'',thesisCard());
  return h+studyActions();
}

function subjectHead(s,open){
  var p=prog(s),ct=curTerm(),old=s.year&&tsort(tkey(s),ct.year+' '+ct.sem)<0;
  var st=failed(s)?'<span class="chip bad">nevyhověl/a</span>':(ready(s)?'<span class="chip good">čeká na zápis výsledku</span>':(old&&!passed(s)?'<span class="chip warn">z dřívějška</span>':''));
  return '<button class="sj-head" type="button" data-act="tsubj" data-s="'+s.id+'" aria-expanded="'+open+'"><span class="nm">'+(s.code?'<small>'+esc(s.code)+'</small>':'')+'<b>'+esc(s.name)+'</b></span>'+
   '<span class="sj-meta"><span class="chip">'+TYPES[s.type]+'</span><span class="chip">'+s.credits+' kr.</span>'+st+'</span>'+
   '<span class="sj-pg"><span class="bar" role="img" aria-label="'+p+' %"><i style="width:'+p+'%"></i></span><b>'+(s.grade?gradeHTML(s):p+' %')+'</b></span><span class="chev" aria-hidden="true">›</span></button>';
}
function subjectCard(s){
  var open=!!ui.open[s.id],reqs=s.reqs.slice().sort(function(a,b){return (a.due||'9999')<(b.due||'9999')?-1:1;});
  return '<article class="sj'+(open?' open':'')+'" style="--c:'+col(s)+'">'+subjectHead(s,open)+
   (open?'<div class="sj-body">'+(reqs.length?'<ul class="list">'+reqs.map(function(r){return reqRow(s,r,false);}).join('')+'</ul>':'<p class="muted">Zatím žádné podmínky. Přidej první, ať se ukáže postup.</p>')+
   '<div class="actions"><button class="btn small" data-act="add-req" data-s="'+s.id+'" type="button">Přidat podmínku</button><button class="btn small" data-act="edit-subj" data-s="'+s.id+'" type="button">Zapsat výsledek / upravit</button><button class="link bad" data-act="del-subj" data-s="'+s.id+'" type="button">Smazat předmět</button></div></div>':'')+'</article>';
}
function subjectRow(s){
  return '<div class="srow" style="--c:'+col(s)+'"><span class="code">'+esc(s.code)+'</span><span class="nm">'+esc(s.name)+'</span><span class="chip">'+TYPES[s.type]+'</span><span class="kr">'+s.credits+' kr.</span>'+gradeHTML(s)+
   '<span class="muted" style="font-size:13px;min-width:92px">'+fmtShort(s.gdate)+'</span><button class="link" data-act="edit-subj" data-s="'+s.id+'" type="button">Upravit</button></div>';
}
function viewSubjects(){
  var h='<div class="head-row"><h2>Předměty</h2><div class="btns" style="margin:0"><button class="btn" data-act="print-subjects" type="button">Vytisknout</button><button class="btn" data-act="bulk-subj" type="button">Vložit víc najednou</button><button class="btn primary" data-act="add-subj" type="button">Přidat předmět</button></div></div>';
  if(!D.subjects.length)return h+noSubjects();
  var ct=curTerm(),ck=ct.year+' '+ct.sem;
  var keys=[];D.subjects.forEach(function(s){var k=tkey(s);if(keys.indexOf(k)<0)keys.push(k);});keys.sort(tsort).reverse();
  function pill(v,l){return '<button type="button" class="pill'+(fl.term===v?' on':'')+'" data-act="fterm" data-id="'+esc(v)+'" aria-pressed="'+(fl.term===v)+'">'+l+'</button>';}
  var f='<div class="filters2"><div class="pills" role="group" aria-label="Semestr">'+pill('cur','Tento semestr')+pill('open','Neukončené')+pill('all','Vše')+'</div>'+
    (keys.length>1?'<select id="f-term" data-change="fterm" aria-label="Jiný semestr"><option value="">Jiný semestr…</option>'+keys.map(function(k){return '<option value="'+esc(k)+'"'+(fl.term===k?' selected':'')+'>'+tlabel(k)+'</option>';}).join('')+'</select>':'')+
    '<div class="pills" role="group" aria-label="Statut">'+Object.keys(STATUT).map(function(k){return '<button type="button" class="pill st'+(fl.statut===k?' on':'')+'" style="--c:'+SCOL[k]+'" data-act="fstatut" data-id="'+k+'" aria-pressed="'+(fl.statut===k)+'" title="'+STATUT[k]+'">'+k+'</button>';}).join('')+'</div>'+
    '<input id="f-q" type="text" data-input="fq" value="'+esc(fl.q)+'" placeholder="Hledat předmět" aria-label="Hledat předmět"></div>';
  var q=fl.q.trim().toLowerCase();
  var list=D.subjects.filter(function(s){
    if(fl.term==='cur'&&tkey(s)!==ck)return false;
    if(fl.term==='open'&&passed(s))return false;
    if(fl.term!=='cur'&&fl.term!=='open'&&fl.term!=='all'&&tkey(s)!==fl.term)return false;
    if(fl.statut&&s.statut!==fl.statut)return false;
    if(q&&(s.name+' '+s.code).toLowerCase().indexOf(q)<0)return false;
    return true;});
  var groups={};list.forEach(function(s){(groups[tkey(s)]=groups[tkey(s)]||[]).push(s);});
  var gk=Object.keys(groups).sort(tsort).reverse(),out='';
  gk.forEach(function(k){
    var g=groups[k].sort(function(a,b){return a.name<b.name?-1:1;}),act=g.filter(function(s){return !passed(s);}),dn=g.filter(passed);
    var cr=g.reduce(function(a,s){return a+s.credits;},0),dc=dn.reduce(function(a,s){return a+s.credits;},0);
    var key='done:'+k,showDone=!!ui.show[key]||(fl.term!=='cur'&&fl.term!=='open'&&fl.term!=='all');
    out+='<div class="term-h"><h3>'+tlabel(k)+'</h3><span class="muted">'+dc+' z '+cr+' kr. · průměr '+avgStr(g)+'</span></div><div class="sjs">'+act.map(subjectCard).join('')+'</div>'+
      (dn.length?'<button class="more-btn" type="button" data-act="more" data-id="'+esc(key)+'" aria-expanded="'+showDone+'">'+(showDone?'Skrýt splněné':'Splněné předměty ('+dn.length+', '+dc+' kr.)')+'</button>'+(showDone?'<div class="stack">'+dn.map(subjectRow).join('')+'</div>':''):'');
  });
  if(!list.length)out='<div class="empty">Tomuto filtru nic neodpovídá. Zkus „Vše“.</div>';
  return h+f+out;
}

function quickAddHTML(){
  var ct=curTerm();
  var opts=D.subjects.filter(function(q){return !passed(q);}).sort(function(a,b){var ca=inTerm(a,ct)?0:1,cb=inTerm(b,ct)?0:1;return ca-cb||(a.name<b.name?-1:1);}).map(function(q){return [q.id,(q.code?q.code+' – ':'')+q.name];});
  if(D.hasThesis)opts.push(['thesis:'+D.id,thesisSubj().name]);
  if(!opts.length)return '';
  if(!opts.some(function(o){return o[0]===ui.qa.sid;}))ui.qa.sid=opts[0][0];
  function ch(v,l){return '<button type="button" class="pill'+(ui.qa.due===v?' on':'')+'" data-act="qdue" data-id="'+v+'" aria-pressed="'+(ui.qa.due===v)+'">'+l+'</button>';}
  var note=D.category_id?'Objeví se i ve Stickies v seznamu „'+esc(catName(D.category_id))+'“.':'';
  return '<form class="card qa" data-form="qa" autocomplete="off"><label class="sr-only" for="qa-text">Nová podmínka nebo termín</label>'+
   '<div class="qa-row"><input id="qa-text" type="text" data-input="qatext" placeholder="Co je potřeba splnit? Stačí pár slov, Enter přidá." value="'+esc(ui.qa.text)+'"><button class="btn primary" type="submit">Přidat</button></div>'+
   '<div class="qa-opts"><select id="qa-subj" data-change="qasubj" aria-label="Předmět">'+opts.map(function(o){return '<option value="'+esc(o[0])+'"'+(o[0]===ui.qa.sid?' selected':'')+'>'+esc(o[1])+'</option>';}).join('')+'</select>'+
   '<div class="pills" role="group" aria-label="Termín">'+ch('today','Dnes')+ch('tomorrow','Zítra')+ch('fri','Pátek')+ch('week','Za týden')+ch('none','Bez termínu')+'</div>'+
   '<input type="date" id="qa-date" data-change="qadate" value="'+esc(ui.qa.date)+'" aria-label="Vlastní datum"></div>'+(note?'<p class="muted qa-note">'+note+'</p>':'')+'</form>';
}
function qaDue(){
  var v=ui.qa.due;
  if(v==='today')return addDays(0);if(v==='tomorrow')return addDays(1);if(v==='fri')return nextFri();if(v==='week')return addDays(7);if(v==='date')return ui.qa.date||'';return '';
}
function groupHTML(key,title,items,cls,limit,hint){
  if(!items.length)return '';
  var all=!!ui.show[key],list=all?items:items.slice(0,limit);
  return '<section class="card grp '+(cls||'')+'"><p class="group-title">'+title+' ('+items.length+')</p>'+(hint?'<p class="soft">'+hint+'</p>':'')+'<ul class="list">'+list.map(function(x){return reqRow(x.s,x.r,true);}).join('')+'</ul>'+
   (items.length>limit?'<button class="more-btn" type="button" data-act="more" data-id="'+key+'" aria-expanded="'+all+'">'+(all?'Ukázat méně':'Ukázat dalších '+(items.length-limit))+'</button>':'')+'</section>';
}
function viewDeadlines(){
  var h='<div class="head-row"><h2>Termíny</h2></div>';
  if(!D.subjects.length&&!D.hasThesis)return h+noSubjects();
  h+=quickAddHTML();
  var open=allReqs().filter(function(x){return x.r.due&&!x.r.done&&!passed(x.s);}).sort(function(a,b){return a.r.due<b.r.due?-1:1;});
  var dz=function(f){return open.filter(function(x){return f(diff(x.r.due));});};
  var out='';
  out+=groupHTML('g-today','Dnes',dz(function(d){return d===0;}),'',5);
  out+=groupHTML('g-week','Tento týden',dz(function(d){return d>=1&&d<=7;}),'',5);
  out+=groupHTML('g-wait','Čeká na dořešení',dz(function(d){return d<0;}).reverse(),'wait',3,'Termín už uplynul. Vyber jednu věc a začni jí, ostatní počkají. Termín jde posunout v nabídce ⋯.');
  out+=groupHTML('g-later','Později',dz(function(d){return d>7;}),'',5);
  if(!open.length)out+='<div class="empty">Žádný otevřený termín. Přidej první nahoře nebo si užij klid.</div>';
  var ct=curTerm(),nodate=allReqs().filter(function(x){return !x.r.due&&!x.r.done&&!passed(x.s)&&(x.s.thesis||inTerm(x.s,ct));});
  out+=groupHTML('g-nodate','Bez termínu v tomto semestru',nodate,'quiet',3);
  var dn=allReqs().filter(function(x){return x.r.done;}).sort(function(a,b){return (a.r.doneAt||'')<(b.r.doneAt||'')?1:-1;});
  out+=groupHTML('g-done','Splněné',dn,'quiet',3);
  return h+out;
}

function viewSessions(){
  var opts=subjOptions();
  var h='<div class="head-row"><h2>Zápisy z výuky</h2><div style="display:flex;gap:10px;flex-wrap:wrap"><div class="fld" style="flex-direction:row;align-items:center;gap:8px"><label for="flt">Předmět</label><select id="flt" data-change="filter"><option value="">Všechny</option>'+opts.map(function(o){return '<option value="'+o[0]+'"'+(o[0]===filterSubj?' selected':'')+'>'+esc(o[1])+'</option>';}).join('')+'</select></div><button class="btn primary" data-act="add-session" type="button"'+(D.subjects.length?'':' disabled')+'>Nový zápis</button></div></div>';
  if(!D.subjects.length)return h+noSubjects();
  var list=D.sessions.filter(function(x){return !filterSubj||x.subjectId===filterSubj;});
  var up=list.filter(function(x){return diff(x.date)>=0;}).sort(function(a,b){return a.date<b.date?-1:1;});
  var past=list.filter(function(x){return diff(x.date)<0;}).sort(function(a,b){return a.date<b.date?1:-1;});
  function card(x){var s=subj(x.subjectId)||{color:'#888',name:'(smazaný předmět)'};
    return '<article class="card sess" style="--c:'+col(s)+'"><div class="top"><div><div class="when">'+fmt(x.date)+' · '+KINDS[x.kind]+'</div><h3>'+esc(x.topic)+'</h3><div style="margin-top:6px">'+chip(s)+'</div></div>'+
     '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end"><div class="seg" role="group" aria-label="Docházka"><button type="button" class="yes" data-act="att" data-id="'+x.id+'" data-v="1" aria-pressed="'+(x.attended===true)+'">Byl/a jsem</button><button type="button" class="no" data-act="att" data-id="'+x.id+'" data-v="0" aria-pressed="'+(x.attended===false)+'">Chyběl/a jsem</button></div>'+
     '<div class="tools"><button class="link" data-act="edit-session" data-id="'+x.id+'" type="button">Upravit</button><button class="link bad" data-act="del-session" data-id="'+x.id+'" type="button">Smazat</button></div></div></div>'+
     '<label class="muted" for="n-'+x.id+'" style="display:block;margin-top:10px;font-size:13px">Poznámky</label><textarea class="note" id="n-'+x.id+'" data-change="note" data-id="'+x.id+'" placeholder="Co jsme probírali, co si pamatovat, co dodělat…">'+esc(x.note)+'</textarea></article>';}
  var out='';
  if(up.length)out+='<p class="group-title">Nadcházející ('+up.length+')</p><div class="sessions">'+up.map(card).join('')+'</div>';
  if(past.length)out+='<p class="group-title" style="margin-top:6px">Proběhlé ('+past.length+')</p><div class="sessions">'+past.map(card).join('')+'</div>';
  if(!list.length)out='<div class="empty">Zatím žádné zápisy. Přidej první hodinu tlačítkem nahoře.</div>';
  return h+out;
}
function viewThesis(){
  var t=D.thesis,L=thesisLabel(),ts=thesisSubj(),p=prog(ts),pg=chPages(),tp=Number(t.targetPages)||0;
  var chd=t.chapters.filter(function(c){return c.status==='done';}).length,chn=t.chapters.length;
  var pgp=tp?Math.min(100,Math.round(100*pg/tp)):0,chp=chn?Math.round(100*chd/chn):0;
  var h='<div class="head-row"><h2>'+L+'</h2><button class="btn" data-act="edit-thesis" type="button">Upravit údaje</button></div>';
  h+='<section class="card"><h3>'+(t.title?esc(t.title):'<span class="muted">Zatím bez názvu</span>')+'</h3>'+
   '<dl class="dl"><div><dt>Vedoucí</dt><dd>'+(t.supervisor?esc(t.supervisor):'<span class="muted">nezadáno</span>')+'</dd></div>'+
   '<div><dt>Pracoviště</dt><dd>'+(t.department?esc(t.department):'<span class="muted">nezadáno</span>')+'</dd></div>'+
   '<div><dt>Zadání schváleno</dt><dd>'+dd(t.dates.assign)+'</dd></div>'+
   '<div><dt>Odevzdání práce</dt><dd>'+dd(t.dates.submit)+'</dd></div>'+
   '<div><dt>Státní závěrečná zkouška</dt><dd>'+dd(t.dates.exam)+'</dd></div>'+
   '<div><dt>Obhajoba</dt><dd>'+dd(t.dates.defense)+'</dd></div></dl></section>';
  h+='<section class="card" style="display:grid;gap:14px"><h3>Postup</h3>'+meter('Etapy práce',p+' %',p)+meter('Kapitoly hotové',chd+' z '+chn,chp)+meter('Rozsah',pg+(tp?' z '+tp:'')+' stran',pgp)+'</section>';
  var rel2=D.subjects.filter(function(s){return s.rel==='thesis';}).sort(function(a,b){return tsort(tkey(a),tkey(b));});
  if(rel2.length)h+='<section class="card"><h3>Předměty k práci</h3><div class="stack" style="margin-top:10px">'+rel2.map(function(s){
    return '<div class="srow" style="--c:'+col(s)+'"><span class="code">'+esc(s.code)+'</span><span class="nm">'+esc(s.name)+'</span><span class="muted" style="font-size:13px">'+tlabel(tkey(s))+'</span><span class="kr">'+s.credits+' kr.</span>'+(s.grade?gradeHTML(s):'<span class="chip">'+prog(s)+' %</span>')+'</div>';}).join('')+'</div></section>';
  var tasks=t.tasks.slice().sort(function(a,b){return (a.due||'9999')<(b.due||'9999')?-1:1;});
  h+='<section class="card"><div class="head-row"><h3>Etapy práce a státnice</h3><div style="display:flex;gap:12px">'+(t.tasks.length?'':'<button class="link" data-act="thesis-template" type="button">Vložit šablonu etap</button>')+'<button class="link" data-act="add-req" data-s="'+ts.id+'" type="button">Přidat etapu</button></div></div>'+
   (tasks.length?'<ul class="list" style="margin-top:6px">'+tasks.map(function(r){return reqRow(ts,r,false);}).join('')+'</ul>':'<p class="muted">Rozděl práci na kroky s termíny. Objeví se i v Deadlinech.</p>')+'</section>';
  h+='<section class="card"><div class="head-row"><h3>Kapitoly</h3><button class="link" data-act="add-ch" type="button">Přidat kapitolu</button></div>'+
   (chn?'<div style="margin-top:6px">'+t.chapters.map(function(c){return '<div class="chrow"><div class="t">'+esc(c.title)+'</div><button type="button" class="chip st-'+c.status+'" data-act="cyc-ch" data-id="'+c.id+'" aria-label="Stav kapitoly '+esc(c.title)+': '+CH_ST[c.status]+'. Klikni pro změnu.">'+CH_ST[c.status]+'</button>'+
     '<label class="muted" for="pg-'+c.id+'" style="font-size:13px">stran</label><input class="pg" type="number" min="0" id="pg-'+c.id+'" data-change="chpages" data-id="'+c.id+'" value="'+(Number(c.pages)||0)+'">'+
     '<div class="tools"><button class="link" data-act="edit-ch" data-id="'+c.id+'" type="button">Upravit</button><button class="link bad" data-act="del-ch" data-id="'+c.id+'" type="button">Smazat</button></div></div>';}).join('')+'</div>':'<p class="muted">Zapiš si osnovu kapitol a sleduj, kolik stran už máš.</p>')+'</section>';
  var cons=t.consultations.slice().sort(function(a,b){return a.date<b.date?1:-1;});
  h+='<section class="card"><div class="head-row"><h3>Konzultace s vedoucím</h3><button class="link" data-act="add-cons" type="button">Přidat konzultaci</button></div>'+
   (cons.length?'<div style="margin-top:6px">'+cons.map(function(c){return '<div class="cons"><div class="head-row"><span class="when">'+fmt(c.date)+'</span><div class="tools"><button class="link" data-act="edit-cons" data-id="'+c.id+'" type="button">Upravit</button><button class="link bad" data-act="del-cons" data-id="'+c.id+'" type="button">Smazat</button></div></div><p>'+esc(c.note)+'</p></div>';}).join('')+'</div>':'<p class="muted">Po každé konzultaci si zapiš, co jste řešili a co máš udělat.</p>')+'</section>';
  h+='<section class="card"><label for="tnotes" class="group-title" style="display:block">Poznámky a nápady</label><textarea class="note" id="tnotes" data-change="tnotes" placeholder="Cokoli k práci, co nepatří do etap ani kapitol.">'+esc(t.notes)+'</textarea></section>';
  return h;
}

function studyActions(){
  return '<div class="btns" style="margin-top:4px;justify-content:flex-end"><button class="btn small" data-act="edit-study" type="button">Upravit údaje o studiu</button><button class="btn small danger" data-act="del-study" type="button">Smazat studium</button></div>';
}
function gradeText(s){
  if(!s.grade)return 'bez výsledku';
  var t=s.grade==='S'?'splněno':s.grade==='F'?'F – nevyhověl':s.grade;
  return t+(s.gdate?' ('+fmtShort(s.gdate)+')':'');
}
function printHTML(html){
  if(HOST&&HOST.print){HOST.print(html);return;}
  var old=document.getElementById('print-root');if(old)old.remove();
  var r=document.createElement('div');r.id='print-root';r.innerHTML=html;document.body.appendChild(r);
  var done=function(){r.remove();window.removeEventListener('afterprint',done);};
  window.addEventListener('afterprint',done);
  setTimeout(function(){window.print();},80);
}
function printSubjects(){
  if(!D||!D.subjects.length){toast('Nejsou žádné předměty k tisku.');return;}
  var keys=[];D.subjects.forEach(function(s){var k=tkey(s);if(keys.indexOf(k)<0)keys.push(k);});keys.sort(tsort);
  var stamp=fmtShort(today());
  var h='<h1>Předměty a jejich ukončení</h1><p class="pr-sub">'+esc(D.name)+' · vytištěno '+stamp+'</p>'+
    '<p class="pr-sum">Získáno '+creditsEarned()+' z '+creditsMin()+' kreditů · vážený průměr '+esc(avgStr(D.subjects))+'</p>';
  keys.forEach(function(k){
    var list=D.subjects.filter(function(s){return tkey(s)===k;}).sort(function(a,b){return a.name.localeCompare(b.name,'cs');});
    var cr=list.reduce(function(a,s){return a+s.credits;},0),ea=list.reduce(function(a,s){return a+(passed(s)?s.credits:0);},0);
    h+='<h2>'+esc(tlabel(k))+' · '+ea+' z '+cr+' kr.</h2><table><thead><tr><th>Kód</th><th>Předmět</th><th class="n">Kr.</th><th>Statut</th><th>Způsob ukončení</th><th>Výsledek</th></tr></thead><tbody>'+
      list.map(function(s){return '<tr><td>'+esc(s.code||'')+'</td><td>'+esc(s.name)+'</td><td class="n">'+s.credits+'</td><td>'+esc(STATUT[s.statut]||s.statut)+'</td><td>'+esc(TYPES[s.type]||s.type)+'</td><td>'+esc(gradeText(s))+'</td></tr>';}).join('')+'</tbody></table>';
  });
  printHTML(h);
}
function studyShort(st){return LEVEL_SHORT[st.level]||(st.name.length>12?st.name.slice(0,11)+'…':st.name);}
function emptyStudies(){
  return '<section class="card now calm" style="text-align:center;padding:30px 18px"><p class="eyebrow">Studium</p><h2>Ať tě škola nepřekvapí</h2><p class="muted" style="max-width:540px;margin:10px auto 18px">Přidej své studium a uvidíš, co je teď nejdůležitější, kolik ti chybí do cíle a kdy co končí. Můžeš mít víc studií vedle sebe, třeba bakalářské a navazující.</p>'+
    '<div class="btns" style="justify-content:center"><button class="btn primary big" data-act="add-study" type="button">Přidat studium</button><button class="btn big" data-act="settings" type="button">Načíst zálohu</button></div></section>'+valueProps();
}
function valueProps(){
  return '<div class="props"><div class="card prop"><b>Jedna věc teď</b><span>Přehled ti ukáže jediný další krok, ne celý seznam povinností.</span></div>'+
   '<div class="card prop"><b>Termíny bez stresu</b><span>Žádné červené výčitky. Co čeká, má klidnou barvu a jde jedním klepnutím posunout.</span></div>'+
   '<div class="card prop"><b>Propojeno se Stickies</b><span>Podmínky se objeví jako lístky ve vybraném seznamu a jdou udělat v režimu soustředění.</span></div></div>';
}
function render(){
  if(!S)return;
  D=cur();
  var r=route;
  var host=document.getElementById('studies'),tabs=document.getElementById('tabs');
  host.innerHTML=S.studies.map(function(st){return '<button type="button" data-act="study" data-id="'+esc(st.id)+'" aria-pressed="'+(!!D&&st.id===D.id)+'" title="'+esc(st.name)+'">'+esc(studyShort(st))+'</button>';}).join('')+
    '<button type="button" data-act="add-study" aria-label="Přidat studium" title="Přidat studium">+</button>';
  if(!D){tabs.innerHTML='';$('#view').innerHTML=emptyStudies();return;}
  if(r==='prace'&&!D.hasThesis)r='prehled';
  tabs.innerHTML=ROUTES.filter(function(x){return x[0]!=='prace'||D.hasThesis;}).map(function(x){return '<a href="#'+x[0]+'" data-act="go" data-id="'+x[0]+'"'+(x[0]===r?' aria-current="page"':'')+'>'+(x[0]==='prace'?thesisLabel():x[1])+'</a>';}).join('');
  var v={prehled:viewOverview,predmety:viewSubjects,deadliny:viewDeadlines,zapisy:viewSessions,prace:viewThesis}[r]();
  var af=document.activeElement,active=af&&af.id,caret=(af&&typeof af.selectionStart==='number')?af.selectionStart:null;
  $('#view').innerHTML=v;
  if(active){var el=document.getElementById(active);if(el&&el.focus){try{el.focus();if(caret!=null&&el.setSelectionRange)el.setSelectionRange(caret,caret);}catch(e){}}}
}

/* ---------- události ---------- */
document.addEventListener('click',function(e){
  var scrim=e.target.getAttribute&&e.target.getAttribute('data-scrim');if(scrim){closeModal();return;}
  var b=e.target.closest&&e.target.closest('[data-act]');if(!b||!S)return;
  if(b.tagName==='A')e.preventDefault();
  var act=b.getAttribute('data-act'),sid=b.getAttribute('data-s'),rid=b.getAttribute('data-r'),id=b.getAttribute('data-id');
  switch(act){
    case 'close':closeModal();break;
    case 'settings':settings();break;
    case 'print-subjects':printSubjects();break;
    case 'study':S.active=id;filterSubj='';save();render();break;
    case 'add-study':newStudyForm();break;
    case 'del-study':confirmBox('Studium „'+D.name+'“ se všemi předměty, zápisy a údaji o práci se smaže. Nejde to vrátit.','Smazat studium',function(){S.studies=S.studies.filter(function(q){return q.id!==D.id;});S.active=S.studies[0]?S.studies[0].id:'';changed();});break;
    case 'go':goRoute(id);break;
    case 'done':setDone(sid,rid,true);break;
    case 'due':setDue(sid,rid,b.getAttribute('data-v'));break;
    case 'totoday':if(HOST&&HOST.toToday){HOST.toToday(id);toast('Přidáno na dnes ve Stickies.');render();}break;
    case 'toast-undo':if(ui.undo){var u=ui.undo;ui.undo=null;$('#toast').hidden=true;u();}break;
    case 'tsubj':ui.open[sid]=!ui.open[sid];render();break;
    case 'tfold':ui.fold[id]=!ui.fold[id];render();break;
    case 'more':ui.show[id]=!ui.show[id];render();break;
    case 'fterm':fl.term=id;render();break;
    case 'fstatut':fl.statut=fl.statut===id?'':id;render();break;
    case 'qdue':ui.qa.due=id;render();var qi=$('#qa-text');if(qi)qi.focus();break;
    case 'bulk-subj':bulkForm();break;
    case 'edit-study':studyForm();break;
    case 'add-subj':subjectForm();break;
    case 'edit-subj':subjectForm(sid);break;
    case 'del-subj':confirmBox('Předmět „'+subj(sid).name+'“ se podmínkami i zápisy z výuky smaže.','Smazat předmět',function(){D.subjects=D.subjects.filter(function(s){return s.id!==sid;});D.sessions=D.sessions.filter(function(x){return x.subjectId!==sid;});D.milestones.forEach(function(m){m.subjectIds=m.subjectIds.filter(function(q){return q!==sid;});});changed();});break;
    case 'add-req':reqForm(sid,null,false);break;
    case 'edit-req':reqForm(sid,rid,false);break;
    case 'del-req':confirmBox('Podmínka se smaže a přepočítají se procenta.','Smazat',function(){var s=subj(sid),i=s.reqs.map(function(r){return r.id;}).indexOf(rid);if(i>-1)s.reqs.splice(i,1);changed();});break;
    case 'add-deadline':reqForm(null,null,true);break;
    case 'add-session':sessionForm();break;
    case 'edit-session':sessionForm(id);break;
    case 'del-session':confirmBox('Zápis i s poznámkami se smaže.','Smazat zápis',function(){D.sessions=D.sessions.filter(function(x){return x.id!==id;});changed();});break;
    case 'att':var x=D.sessions.filter(function(q){return q.id===id;})[0],val=b.getAttribute('data-v')==='1';x.attended=(x.attended===val)?null:val;changed();break;
    case 'edit-thesis':thesisForm();break;
    case 'thesis-template':[['Rešerše a osnova',2],['Teoretická část',3],['Praktická část',3],['Závěr a abstrakt',1],['Formální úpravy a bibliografie',2],['Odevzdání',1]].forEach(function(q){D.thesis.tasks.push({id:uid(),title:q[0],weight:q[1],due:'',done:false,doneAt:'',note:''});});changed();break;
    case 'add-ch':chapterForm();break;
    case 'edit-ch':chapterForm(id);break;
    case 'cyc-ch':var ch=D.thesis.chapters.filter(function(q){return q.id===id;})[0];ch.status=CH_NEXT[ch.status];changed();break;
    case 'del-ch':confirmBox('Kapitola se smaže.','Smazat kapitolu',function(){D.thesis.chapters=D.thesis.chapters.filter(function(q){return q.id!==id;});changed();});break;
    case 'add-cons':consForm();break;
    case 'edit-cons':consForm(id);break;
    case 'del-cons':confirmBox('Záznam o konzultaci se smaže.','Smazat konzultaci',function(){D.thesis.consultations=D.thesis.consultations.filter(function(q){return q.id!==id;});changed();});break;
  }
});
document.addEventListener('input',function(e){
  var t=e.target,k=t.getAttribute&&t.getAttribute('data-input');if(k==='fq'&&S){fl.q=t.value;render();}
  else if(k==='qatext')ui.qa.text=t.value;
});
document.addEventListener('change',function(e){
  var t=e.target,k=t.getAttribute&&t.getAttribute('data-change');if(!k||!S)return;
  if(k==='toggle'){setDone(t.getAttribute('data-s'),t.getAttribute('data-r'),t.checked);}
  else if(k==='qasubj'){ui.qa.sid=t.value;}
  else if(k==='qadate'){ui.qa.date=t.value;ui.qa.due=t.value?'date':ui.qa.due;render();}
  else if(k==='filter'){filterSubj=t.value;render();}
  else if(k==='fterm'){if(t.value){fl.term=t.value;render();}}
  else if(k==='fstatut'){fl.statut=t.value;render();}
  else if(k==='chpages'){var c2=D.thesis.chapters.filter(function(q){return q.id===t.getAttribute('data-id');})[0];if(c2){c2.pages=Math.max(0,Number(t.value)||0);changed();}}
  else if(k==='tnotes'){D.thesis.notes=t.value;save();}
  else if(k==='note'){var x=D.sessions.filter(function(q){return q.id===t.getAttribute('data-id');})[0];if(x){x.note=t.value;save();}}
});
document.addEventListener('submit',function(e){
  var f=e.target;if(!f.getAttribute||f.getAttribute('data-form')!=='qa')return;
  e.preventDefault();
  var title=ui.qa.text.trim();if(!title){var qi=$('#qa-text');if(qi)qi.focus();return;}
  var sj=subj(ui.qa.sid);if(!sj)return;
  var due=qaDue(),req={id:uid(),title:title,weight:1,due:due,done:false,doneAt:'',note:''};
  sj.reqs.push(req);ui.qa.text='';changed();
  toast('Přidáno'+(due?' na '+fmt(due).replace(/\.$/,''):'')+'.',function(){var i=sj.reqs.indexOf(req);if(i>-1)sj.reqs.splice(i,1);changed();});
  var qi2=$('#qa-text');if(qi2)qi2.focus();
});
document.addEventListener('click',function(e){
  var os=document.querySelectorAll('details.more[open]');
  for(var i=0;i<os.length;i++)if(!os[i].contains(e.target))os[i].removeAttribute('open');
});
function goRoute(r){
  r=ALIAS[r]||r;
  if(!ROUTES.some(function(x){return x[0]===r;}))r='prehled';
  route=r;render();window.scrollTo(0,0);
  if(HOST)HOST.route(r,true);
}
function onHash(){var h=location.hash.slice(1);h=ALIAS[h]||h;route=ROUTES.some(function(r){return r[0]===h;})?h:'prehled';render();if(HOST)HOST.route(route,false);}
window.addEventListener('hashchange',onHash);

/* rozhraní pro Stickies (rodičovské okno) */
window.Studium={
  go:function(r){r=ALIAS[r]||r;if(ROUTES.some(function(x){return x[0]===r;})&&r!==route){route=r;render();}},
  /* nová data z úložiště: přepíše zobrazení, pokud je co a nic se neukládá */
  refresh:function(){
    if(!HOST||saveTimer)return;
    var list=HOST.getStudies();
    if(JSON.stringify(list)===snap)return;
    var ae=document.activeElement;if(ae&&(ae.tagName==='TEXTAREA'||ae.tagName==='INPUT')&&ae.closest('#view'))return;
    if(document.getElementById('mform'))return;
    var act=S&&S.active;loadFromHost();if(S.studies.some(function(x){return x.id===act;}))S.active=act;render();
  },
  flush:function(){if(saveTimer){clearTimeout(saveTimer);doSave();}}
};
window.addEventListener('pagehide',function(){if(saveTimer){clearTimeout(saveTimer);doSave();}});

loadFromHost();
D=cur();
onHash();
setStatus(HOST?'Uloženo':'Aplikace běží mimo Stickies, nic se neukládá.');
})();
