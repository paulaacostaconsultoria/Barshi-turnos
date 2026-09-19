
(function(){
"use strict";

const $ = (id) => document.getElementById(id);
const LOCAL_KEY = "barshi-db";
const OPEN_MIN = 9*60;
const CLOSE_MIN = 20*60;
const SLOT_STEP = 15;
const CLEANING_BUFFER = 15;
const CLUB_STAMP_LOGO = "./assets/barshi-isotipo.svg";
const PUSH_PUBLIC_KEY = "BA3EKQf4ha73WaDVyazcW9h2dIlE9uomUKEQzU8-GasJSsqikioeaDGV3Io40CTTAAyABAPpMnLIUwzsuc6YdM0";
const SUPABASE_FALLBACK = {
  url: "https://vzpeofhmqrumcgwzwkkr.supabase.co",
  publishableKey: "sb_publishable_p8C4f1CPFc5nSn7c-zVTHA_qYzcLYzn"
};

const defaults = {
  services:[
    {id:1,name:"Corte clásico",desc:"Asesoramiento, corte y terminación.",duration:45,price:12000,active:true},
    {id:2,name:"Perfilado de barba",desc:"Diseño, perfilado y cuidado.",duration:30,price:9000,active:true},
    {id:3,name:"Corte + barba",desc:"La experiencia Barshi completa.",duration:70,price:18000,active:true}
  ],
  pros:[
    {id:1,name:"Nicolás",active:true},
    {id:2,name:"Franco",active:true}
  ],
  appointments:[],
  promotions:[],
  scheduleBlocks:[],
  businessHours:[
    {day_of_week:1,is_open:false,open_time:"09:00",close_time:"20:00"},
    {day_of_week:2,is_open:true,open_time:"09:00",close_time:"20:00"},
    {day_of_week:3,is_open:true,open_time:"09:00",close_time:"20:00"},
    {day_of_week:4,is_open:true,open_time:"09:00",close_time:"20:00"},
    {day_of_week:5,is_open:true,open_time:"09:00",close_time:"20:00"},
    {day_of_week:6,is_open:true,open_time:"09:00",close_time:"20:00"},
    {day_of_week:7,is_open:false,open_time:"09:00",close_time:"20:00"}
  ],
  wa:{number:"",reminder:"24 horas antes"},
  settings:{
    businessName:"Barshi Barber",tagline:"Estilo que te define",address:"Magallanes 436",city:"Tandil",
    logoUrl:"",slotStep:15,bookingHorizon:30,minimumNotice:30,
    clubEnabled:true,clubLabel:"CLUB BARSHI",
    clubTitle:"Nueve visitas. La décima, por la casa.",
    clubLegend:"Reservá siempre con el mismo WhatsApp. Barshi valida un sello después de cada corte.",
    clubGoal:10,clubRewardText:"GRATIS",clubBadgeText:"El 10.º corte es gratis"
  }
};

const storedDb = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null") || {};
let db = {
  services:Array.isArray(storedDb.services)?storedDb.services:JSON.parse(JSON.stringify(defaults.services)),
  pros:Array.isArray(storedDb.pros)?storedDb.pros:JSON.parse(JSON.stringify(defaults.pros)),
  appointments:Array.isArray(storedDb.appointments)?storedDb.appointments:[],
  promotions:Array.isArray(storedDb.promotions)?storedDb.promotions:[],
  scheduleBlocks:Array.isArray(storedDb.scheduleBlocks)?storedDb.scheduleBlocks:[],
  businessHours:Array.isArray(storedDb.businessHours)&&storedDb.businessHours.length?storedDb.businessHours:JSON.parse(JSON.stringify(defaults.businessHours)),
  wa:Object.assign({},defaults.wa,storedDb.wa||{}),
  settings:Object.assign({},defaults.settings,storedDb.settings||{})
};
let booking = {service:null,pro:null,date:"",time:"",name:"",wa:""};
let supa = null;
let cloud = false;
let adminReady = false;
let cloudSlots = [];
let cloudAppointments = [];
let cloudAllServices = [];
let cloudAllPros = [];
let cloudScheduleBlocks = [];
let cloudPromotions = [];
let cloudHistory = [];
let defaultLogoSrc = "";

function money(v){
  const n = Number(String(v).replace(/\./g,"").replace(",","."));
  return "$ " + new Intl.NumberFormat("es-AR",{maximumFractionDigits:0}).format(Number.isFinite(n)?n:0);
}
function parsePrice(v){
  const cleaned = String(v).trim().replace(/\s/g,"").replace(/\./g,"").replace(",",".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}
function saveLocal(){
  localStorage.setItem(LOCAL_KEY, JSON.stringify(db));
}
function getSupabaseConfig(){
  const c=window.BARSHI_SUPABASE||{};
  return {
    url:c.url||SUPABASE_FALLBACK.url,
    publishableKey:c.publishableKey||SUPABASE_FALLBACK.publishableKey
  };
}
function cloudConfigured(){
  const c=getSupabaseConfig();
  return !!(c.url && c.publishableKey && window.supabase && window.supabase.createClient);
}
function mapService(s){
  return {
    id:s.id,
    name:s.name,
    desc:s.description || "",
    duration:Number(s.duration_minutes || s.duration || 30),
    price:Number(s.price || 0),
    active:s.active !== false,
    sort_order:Number(s.sort_order || 0)
  };
}
function mapPro(p){
  return {id:p.id,name:p.name,active:p.active !== false};
}
function mapHour(h){
  return {
    day_of_week:Number(h.day_of_week),
    is_open:!!h.is_open,
    open_time:String(h.open_time||"09:00").slice(0,5),
    close_time:String(h.close_time||"20:00").slice(0,5)
  };
}
function applySettingsRow(s){
  if(!s) return;
  db.wa.number=s.whatsapp_business || "";
  db.wa.reminder=String(s.reminder_hours || 24)+" horas antes";
  db.settings={
    businessName:s.business_name || "Barshi Barber",
    tagline:s.tagline || "Estilo que te define",
    address:s.address || "Magallanes 436",
    city:s.city || "Tandil",
    logoUrl:s.logo_url || "",
    slotStep:Number(s.slot_step_minutes||15),
    bookingHorizon:Number(s.booking_horizon_days||30),
    minimumNotice:Number(s.minimum_notice_minutes||30),
    clubEnabled:s.club_enabled !== false,
    clubLabel:s.club_label || "CLUB BARSHI",
    clubTitle:s.club_title || "Nueve visitas. La décima, por la casa.",
    clubLegend:s.club_legend || "Reservá siempre con el mismo WhatsApp. Barshi valida un sello después de cada corte.",
    clubGoal:Number(s.club_goal||10),
    clubRewardText:s.club_reward_text || "GRATIS",
    clubBadgeText:s.club_badge_text || "El 10.º corte es gratis"
  };
}
function dateKey(d){
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,"0");
  const day=String(d.getDate()).padStart(2,"0");
  return y+"-"+m+"-"+day;
}
function formatDate(k){
  if(!k) return "";
  const p=k.split("-");
  return p[2]+"/"+p[1]+"/"+p[0];
}
function timeToMinutes(t){
  const p=String(t).slice(0,5).split(":").map(Number);
  return p[0]*60+p[1];
}
function endTimeLabel(start,duration){
  const total=timeToMinutes(start)+Number(duration||30)+CLEANING_BUFFER;
  return String(Math.floor(total/60)).padStart(2,"0")+":"+String(total%60).padStart(2,"0");
}
function intervalsOverlap(startA,durA,startB,durB){
  const a1=timeToMinutes(startA), a2=a1+Number(durA);
  const b1=timeToMinutes(startB), b2=b1+Number(durB);
  return a1<b2 && b1<a2;
}
function upcomingBusinessDays(){
  const out=[], d=new Date();
  d.setHours(12,0,0,0);
  const horizon=Math.max(10,Number(db.settings&&db.settings.bookingHorizon)||30);
  for(let i=0;out.length<10 && i<=horizon;i++){
    const x=new Date(d);
    x.setDate(d.getDate()+i);
    const iso=x.getDay()===0?7:x.getDay();
    const cfg=(db.businessHours||[]).find(function(h){return Number(h.day_of_week)===iso;});
    if(cfg && cfg.is_open) out.push(x);
  }
  return out;
}

function urlBase64ToUint8Array(base64String){
  const padding="=".repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(base64);
  const output=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) output[i]=raw.charCodeAt(i);
  return output;
}
async function registerPushWorker(){
  if(!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  try{
    return await navigator.serviceWorker.register("/push-sw.js");
  }catch(e){
    console.warn("No se pudo registrar el service worker",e);
    return null;
  }
}
async function updatePushNotificationStatus(){
  const el=$("pushStatus");
  if(!el) return;
  if(!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)){
    el.textContent="Este navegador no permite notificaciones push.";
    return;
  }
  if(Notification.permission==="denied"){
    el.textContent="Las notificaciones están bloqueadas en este celular. Habilitalas desde los permisos del navegador.";
    return;
  }
  if(Notification.permission!=="granted"){
    el.textContent="Notificaciones todavía no activadas en este celular.";
    return;
  }
  const reg=await registerPushWorker();
  const sub=reg ? await reg.pushManager.getSubscription() : null;
  el.textContent=sub ? "✓ Notificaciones activas en este celular." : "Permiso concedido. Tocá Activar para terminar la configuración.";
}
window.enablePushNotifications=async function(){
  if(!cloud || !adminReady) return alert("Ingresá primero al panel de Barshi.");
  if(!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)){
    return alert("Este navegador no permite notificaciones push.");
  }
  let permission=Notification.permission;
  if(permission!=="granted") permission=await Notification.requestPermission();
  if(permission!=="granted"){
    await updatePushNotificationStatus();
    return alert("Para recibir nuevas reservas necesitás permitir las notificaciones.");
  }
  const reg=await registerPushWorker();
  if(!reg) return alert("No pudimos activar las notificaciones en este celular.");
  let sub=await reg.pushManager.getSubscription();
  if(!sub){
    sub=await reg.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:urlBase64ToUint8Array(PUSH_PUBLIC_KEY)
    });
  }
  const json=sub.toJSON();
  const sessionRes=await supa.auth.getSession();
  const user=sessionRes.data.session&&sessionRes.data.session.user;
  if(!user) return alert("Tu sesión de administración venció. Volvé a ingresar.");
  const res=await supa.from("admin_push_subscriptions").upsert({
    user_id:user.id,
    endpoint:sub.endpoint,
    p256dh:json.keys&&json.keys.p256dh,
    auth:json.keys&&json.keys.auth,
    updated_at:new Date().toISOString()
  },{onConflict:"endpoint"});
  if(res.error){
    console.error(res.error);
    return alert("No pudimos guardar la suscripción de notificaciones.");
  }
  await updatePushNotificationStatus();
  alert("Listo. Este celular recibirá un aviso inmediato cuando entre una nueva reserva.");
};
window.disablePushNotifications=async function(){
  if(!("serviceWorker" in navigator)) return;
  const reg=await navigator.serviceWorker.getRegistration("/push-sw.js");
  const sub=reg ? await reg.pushManager.getSubscription() : null;
  if(sub && cloud && adminReady){
    await supa.from("admin_push_subscriptions").delete().eq("endpoint",sub.endpoint);
  }
  if(sub) await sub.unsubscribe();
  await updatePushNotificationStatus();
};
async function init(){
  registerPushWorker();
  const initialLogo=$("brandLogo");
  if(initialLogo) defaultLogoSrc=initialLogo.src;
  if($("blockDate")) $("blockDate").min=dateKey(new Date());
  if(cloudConfigured()){
    const c=getSupabaseConfig();
    supa=window.supabase.createClient(c.url,c.publishableKey);
    cloud=true;
    await loadPublicData();
    supa.auth.onAuthStateChange(async function(event,session){
      if(event==="SIGNED_OUT"){ adminReady=false; closeAdmin(); }
      if(session && (event==="SIGNED_IN" || event==="INITIAL_SESSION")){
        adminReady=await verifyAdmin(session.user.id);
      }
    });
  }
  renderAll();
}
async function loadPublicData(){
  try{
    const results=await Promise.all([
      supa.from("services").select("*").eq("active",true).order("sort_order"),
      supa.from("professionals").select("*").eq("active",true).order("name"),
      supa.from("settings").select("*").eq("id",1).maybeSingle(),
      supa.from("business_hours").select("*").order("day_of_week"),
      supa.from("promotions").select("*").eq("active",true).order("sort_order").order("created_at")
    ]);
    if(results[0].error) throw results[0].error;
    if(results[1].error) throw results[1].error;
    db.services=(results[0].data||[]).map(mapService);
    db.pros=(results[1].data||[]).map(mapPro);
    if(results[2].data) applySettingsRow(results[2].data);
    if(!results[3].error && results[3].data && results[3].data.length) db.businessHours=results[3].data.map(mapHour);
    if(!results[4].error) db.promotions=results[4].data||[];
  }catch(e){
    console.error("Supabase public load failed",e);
    cloud=false;
  }
}

function renderAll(){
  applyPublicBusinessInfo();
  renderServices();
  renderPros();
  renderAdmin();
  renderAgendaPicker();
  renderAdminAgenda();
  renderAdminHistory();
  renderHoursEditor();
  renderScheduleBlocks();
  renderBusinessForm();
  renderClubPublic();
  renderClubAdmin();
  renderPromotionsAdmin();
}
function renderServices(){
  const el=$("serviceGrid");
  if(!el) return;
  el.innerHTML=(db.services||[]).filter(function(s){return s.active!==false;}).map(function(s){
    const sel=booking.service && String(booking.service.id)===String(s.id) ? " sel" : "";
    return '<div class="choice'+sel+'" onclick="selectService(\''+s.id+'\')"><h4>'+escapeHtml(s.name)+'</h4><p>'+escapeHtml(s.desc||"")+'</p><div class="meta">'+Number(s.duration)+' min · '+money(s.price)+'</div></div>';
  }).join("");
}
function renderPros(){
  const el=$("proGrid");
  if(!el) return;
  const active=(db.pros||[]).filter(function(p){return p.active;});
  let html='<div class="choice '+(booking.pro==="any"?"sel":"")+'" onclick="selectPro(\'any\')"><h4>Cualquier profesional</h4><p>Te asignamos el próximo disponible.</p><div class="meta">Más opciones de horario</div></div>';
  html+=active.map(function(p){
    const sel=booking.pro && booking.pro!=="any" && String(booking.pro.id)===String(p.id) ? " sel" : "";
    return '<div class="choice'+sel+'" onclick="selectPro(\''+p.id+'\')"><h4>'+escapeHtml(p.name)+'</h4><p>Profesional Barshi</p><div class="meta">Elegir a '+escapeHtml(p.name)+'</div></div>';
  }).join("");
  el.innerHTML=html;
}
function escapeHtml(v){
  return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c];});
}

window.selectService=function(id){
  booking.service=(db.services||[]).find(function(s){return String(s.id)===String(id);})||null;
  booking.date=""; booking.time="";
  renderServices();
};
window.selectPro=function(id){
  booking.pro=id==="any" ? "any" : ((db.pros||[]).find(function(p){return String(p.id)===String(id);})||null);
  booking.date=""; booking.time="";
  renderPros();
};
window.nextService=function(){
  if(!booking.service) return alert("Elegí un servicio.");
  go(2);
};
window.nextPro=async function(){
  if(!booking.pro) return alert("Elegí un profesional.");
  booking.date=""; booking.time="";
  renderAgendaPicker();
  go(3);
};
window.nextTime=function(){
  if(!booking.date || !booking.time) return alert("Elegí un día y un horario disponible.");
  go(4);
};

function renderAgendaPicker(){
  const days=$("agendaDays"), slots=$("slotGrid");
  if(!days || !slots) return;
  const ds=upcomingBusinessDays();
  days.innerHTML=ds.map(function(d){
    const k=dateKey(d);
    const wd=d.toLocaleDateString("es-AR",{weekday:"short"});
    const dm=d.toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit"});
    return '<button class="day-btn '+(booking.date===k?"sel":"")+'" onclick="pickDay(\''+k+'\')"><b>'+wd+'</b><small>'+dm+'</small></button>';
  }).join("");
  if(!booking.date){ slots.innerHTML=""; return; }
  refreshSlots();
}
async function refreshSlots(){
  const slots=$("slotGrid"), hint=$("slotHint");
  if(!slots || !booking.date || !booking.service) return;
  slots.innerHTML='<div class="notice" style="grid-column:1/-1">Consultando disponibilidad…</div>';
  if(cloud){
    const proId=booking.pro==="any" ? null : booking.pro.id;
    const res=await supa.rpc("available_slots",{
      p_date:booking.date,
      p_service_id:booking.service.id,
      p_professional_id:proId
    });
    if(res.error){
      console.error(res.error);
      slots.innerHTML='<div class="notice" style="grid-column:1/-1">No pudimos consultar la agenda. Probá de nuevo.</div>';
      return;
    }
    cloudSlots=res.data||[];
    const available=new Set(cloudSlots.map(function(r){return String(r.slot_time).slice(0,5);}));
    renderSlotButtons(available,true);
  }else{
    const available=new Set();
    const cfg=hourConfigForDate(booking.date)||{open_time:"09:00",close_time:"20:00"};
    const open=timeToMinutes(cfg.open_time);
    const close=timeToMinutes(cfg.close_time);
    for(let m=open;m<close;m+=SLOT_STEP){
      const t=String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");
      if(!slotUnavailableLocal(booking.date,t)) available.add(t);
    }
    renderSlotButtons(available,false);
  }
  if(hint){
    if(booking.time) hint.textContent="Turno seleccionado: "+formatDate(booking.date)+" a las "+booking.time+".";
    else if(available.size===0) hint.textContent="No hay turnos disponibles para ese día. Probá con otra fecha.";
    else hint.textContent="Elegí uno de los horarios disponibles.";
  }
}
function renderSlotButtons(available,fromCloud){
  const slots=$("slotGrid");
  const cfg=hourConfigForDate(booking.date) || {open_time:"09:00",close_time:"20:00"};
  const open=timeToMinutes(cfg.open_time);
  const close=timeToMinutes(cfg.close_time);
  const step=(db.settings&&db.settings.slotStep)||SLOT_STEP;
  let out=[];
  for(let m=open;m<close;m+=step){
    const t=String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");
    const ok=available.has(t);
    out.push('<button class="slot '+(!ok?"busy":"")+' '+(booking.time===t?"sel":"")+'" '+(!ok?"disabled":'onclick="pickTime(\''+t+'\')"')+'>'+t+'</button>');
  }
  slots.innerHTML=out.join("");
}
function hourConfigForDate(day){
  const d=new Date(day+"T12:00:00");
  const iso=d.getDay()===0?7:d.getDay();
  return (db.businessHours||[]).find(function(h){return Number(h.day_of_week)===iso;}) || null;
}
function blockOverlapsLocal(day,proId,time,duration){
  return (db.scheduleBlocks||[]).some(function(b){
    if(b.block_date!==day) return false;
    if(b.professional_id && String(b.professional_id)!==String(proId)) return false;
    if(!b.start_time && !b.end_time) return true;
    return intervalsOverlap(time,duration+CLEANING_BUFFER,String(b.start_time).slice(0,5),timeToMinutes(String(b.end_time).slice(0,5))-timeToMinutes(String(b.start_time).slice(0,5)));
  });
}
function slotUnavailableLocal(day,time){
  if(!booking.service) return true;
  const cfg=hourConfigForDate(day);
  if(!cfg || !cfg.is_open) return true;
  const duration=Number(booking.service.duration)||30;
  const start=timeToMinutes(time);
  const open=timeToMinutes(cfg.open_time), close=timeToMinutes(cfg.close_time);
  if(start<open || start>=close) return true;
  const now=new Date();
  const notice=Number(db.settings&&db.settings.minimumNotice)||0;
  if(day===dateKey(now) && start<=(now.getHours()*60+now.getMinutes()+notice)) return true;
  if(booking.pro==="any"){
    return !(db.pros||[]).some(function(p){return p.active && !professionalBusyLocal(p.id,day,time,duration);});
  }
  return !booking.pro || professionalBusyLocal(booking.pro.id,day,time,duration);
}
function professionalBusyLocal(proId,day,time,duration){
  if(blockOverlapsLocal(day,proId,time,duration)) return true;
  return (db.appointments||[]).some(function(a){
    if(a.date!==day || a.status==="cancelled") return false;
    if(a.proId!=null && String(a.proId)!==String(proId)) return false;
    return intervalsOverlap(time,duration,a.time,Number(a.duration||30)+CLEANING_BUFFER);
  });
}
window.pickDay=function(k){ booking.date=k; booking.time=""; renderAgendaPicker(); };
window.pickTime=function(t){ booking.time=t; renderAgendaPicker(); };

window.confirmBooking=async function(){
  const nameEl=$("name"), waEl=$("wa");
  if(!nameEl.value.trim() || !waEl.value.trim()) return alert("Completá nombre y WhatsApp.");
  if($("waConsent") && !$("waConsent").checked) return alert("Necesitamos tu autorización para enviarte la confirmación y el recordatorio por WhatsApp.");
  if(!booking.service || !booking.date || !booking.time) return alert("Falta seleccionar el turno.");
  booking.name=nameEl.value.trim(); booking.wa=waEl.value.trim();

  let proName="";
  if(cloud){
    const proId=booking.pro==="any" ? null : booking.pro.id;
    const res=await supa.rpc("book_appointment",{
      p_service_id:booking.service.id,
      p_professional_id:proId,
      p_date:booking.date,
      p_time:booking.time+":00",
      p_client_name:booking.name,
      p_client_whatsapp:booking.wa
    });
    if(res.error){
      alert(res.error.message && /disponible/i.test(res.error.message) ? "Ese horario ya no está disponible. Elegí otro." : "No pudimos confirmar el turno. Probá nuevamente.");
      booking.time="";
      renderAgendaPicker();
      go(3);
      return;
    }
    const row=(res.data||[])[0];
    proName=row ? row.professional_name : (booking.pro==="any" ? "Profesional disponible" : booking.pro.name);
  }else{
    const duration=Number(booking.service.duration)||30;
    if(slotUnavailableLocal(booking.date,booking.time)){
      alert("Ese horario ya no está disponible. Elegí otro.");
      booking.time=""; renderAgendaPicker(); go(3); return;
    }
    let assigned=booking.pro;
    if(assigned==="any"){
      assigned=(db.pros||[]).find(function(p){return p.active && !professionalBusyLocal(p.id,booking.date,booking.time,duration);});
    }
    proName=assigned.name;
    db.appointments=db.appointments||[];
    db.appointments.push({
      id:Date.now(),date:booking.date,time:booking.time,duration:duration,
      service:booking.service.name,serviceId:booking.service.id,
      pro:proName,proId:assigned.id,name:booking.name,wa:booking.wa,status:"confirmed"
    });
    saveLocal();
  }

  const summary=$("summary");
  summary.innerHTML=
    '<div class="row"><span>Servicio</span><b>'+escapeHtml(booking.service.name)+'</b></div>'+
    '<div class="row"><span>Profesional</span><b>'+escapeHtml(proName)+'</b></div>'+
    '<div class="row"><span>Fecha</span><b>'+formatDate(booking.date)+'</b></div>'+
    '<div class="row"><span>Hora</span><b>'+booking.time+'</b></div>'+
    '<div class="row"><span>Duración</span><b>'+Number(booking.service.duration)+' min</b></div>'+
    '<div class="row"><span>Cliente</span><b>'+escapeHtml(booking.name)+'</b></div>'+
    '<div class="row"><span>WhatsApp</span><b>'+escapeHtml(booking.wa)+'</b></div>';
  go(5);
  if(cloud) await refreshSlots();
  renderAdminAgenda();
};

function go(n){
  [1,2,3,4,5].forEach(function(i){
    const el=$("s"+i); if(el) el.classList.toggle("hidden",i!==n);
  });
  document.querySelectorAll(".step").forEach(function(el,i){el.classList.toggle("on",i<n);});
  const bookingEl=$("booking");
  if(bookingEl) window.scrollTo({top:bookingEl.offsetTop-10,behavior:"smooth"});
}
window.resetBooking=function(){
  booking={service:null,pro:null,date:"",time:"",name:"",wa:""};
  if($("name")) $("name").value="";
  if($("wa")) $("wa").value="";
  if($("waConsent")) $("waConsent").checked=false;
  renderAll(); go(1);
};

async function verifyAdmin(userId){
  if(!cloud) return true;
  const res=await supa.from("admin_users").select("user_id").eq("user_id",userId).maybeSingle();
  return !res.error && !!res.data;
}
window.openAdmin=async function(){
  if(!cloud){
    showAuth("No pudimos conectar con la base de datos. Recargá la página e intentá nuevamente.");
    return;
  }
  const sessionRes=await supa.auth.getSession();
  const session=sessionRes.data.session;
  if(!session || !(await verifyAdmin(session.user.id))){
    showAuth();
    return;
  }
  adminReady=true;
  await loadAdminData();
  $("drawer").classList.add("open");
  if($("logoutBtn")) $("logoutBtn").classList.remove("hidden");
};
window.closeAdmin=function(){
  if($("drawer")) $("drawer").classList.remove("open");
};
function showAuth(msg){
  const modal=$("authModal");
  if(modal) modal.classList.remove("hidden");
  if($("authError")) $("authError").textContent=msg||"";
}
window.closeAuth=function(){
  if($("authModal")) $("authModal").classList.add("hidden");
  if($("authError")) $("authError").textContent="";
};
window.adminLogin=async function(){
  if(!cloud) return;
  const email=$("adminEmail").value.trim();
  const password=$("adminPassword").value;
  if(!email || !password){ showAuth("Ingresá email y contraseña."); return; }
  const btn=$("adminLoginBtn");
  if(btn){btn.disabled=true;btn.textContent="Ingresando…";}
  const res=await supa.auth.signInWithPassword({email:email,password:password});
  if(btn){btn.disabled=false;btn.textContent="Ingresar";}
  if(res.error){ showAuth("Datos incorrectos."); return; }
  if(!(await verifyAdmin(res.data.user.id))){
    await supa.auth.signOut();
    showAuth("Este usuario no tiene permisos de administración.");
    return;
  }
  adminReady=true;
  closeAuth();
  await loadAdminData();
  $("drawer").classList.add("open");
  if($("logoutBtn")) $("logoutBtn").classList.remove("hidden");
};
window.adminLogout=async function(){
  if(cloud) await supa.auth.signOut();
  adminReady=false;
  closeAdmin();
};
window.tab=function(id,btn){
  ["services","pros","agenda","history","hours","business","club","whatsapp"].forEach(function(x){
    const el=$("tab-"+x); if(el) el.classList.toggle("hidden",x!==id);
  });
  document.querySelectorAll(".tab").forEach(function(x){x.classList.remove("on");});
  if(btn) btn.classList.add("on");
  if(id==="agenda") renderAdminAgenda();
  if(id==="history") renderAdminHistory();
  if(id==="whatsapp") updatePushNotificationStatus();
};

async function loadAdminData(){
  if(!cloud || !adminReady) return;
  const historyStart=new Date();
  historyStart.setDate(historyStart.getDate()-30);
  const historyStartKey=dateKey(historyStart);
  const results=await Promise.all([
    supa.from("services").select("*").order("sort_order"),
    supa.from("professionals").select("*").order("name"),
    supa.from("appointments")
      .select("id,client_id,appointment_date,appointment_time,duration_minutes,status,client_name,client_whatsapp,service_id,professional_id,services(name),professionals(name),clients(stamps,reward_available,club_access_token)")
      .gte("appointment_date",historyStartKey)
      .order("appointment_date",{ascending:true})
      .order("appointment_time",{ascending:true}),
    supa.from("schedule_blocks")
      .select("id,block_date,start_time,end_time,reason,professional_id,professionals(name)")
      .gte("block_date",dateKey(new Date()))
      .order("block_date",{ascending:true}),
    supa.from("business_hours").select("*").order("day_of_week"),
    supa.from("settings").select("*").eq("id",1).maybeSingle(),
    supa.from("promotions").select("*").order("sort_order").order("created_at"),
    supa.from("appointments")
      .select("id,appointment_date,appointment_time,status,client_name,client_whatsapp,service_id,professional_id,services(name),professionals(name),clients(stamps,reward_available)")
      .eq("status","completed")
      .order("appointment_date",{ascending:false})
      .order("appointment_time",{ascending:false})
      .limit(1000)
  ]);
  if(!results[0].error) cloudAllServices=(results[0].data||[]).map(mapService);
  if(!results[1].error) cloudAllPros=(results[1].data||[]).map(mapPro);
  if(!results[2].error) cloudAppointments=results[2].data||[];
  if(!results[3].error) cloudScheduleBlocks=results[3].data||[];
  if(!results[4].error && results[4].data) db.businessHours=results[4].data.map(mapHour);
  if(!results[5].error && results[5].data) applySettingsRow(results[5].data);
  if(!results[6].error) cloudPromotions=results[6].data||[];
  if(!results[7].error) cloudHistory=results[7].data||[];
  renderAdmin();
  renderAdminAgenda();
  renderHoursEditor();
  renderScheduleBlocks();
  renderBusinessForm();
  renderClubPublic();
  renderClubAdmin();
  renderPromotionsAdmin();
  applyPublicBusinessInfo();
  updatePushNotificationStatus();
}
function renderAdmin(){
  const serviceEl=$("adminServices"), proEl=$("adminPros");
  const services=cloud && adminReady ? cloudAllServices : (db.services||[]);
  const pros=cloud && adminReady ? cloudAllPros : (db.pros||[]);
  if(serviceEl){
    serviceEl.innerHTML=services.map(function(s){
      return '<div class="admin-item"><strong>'+escapeHtml(s.name)+'</strong>'+
        '<span style="color:var(--muted)">'+Number(s.duration)+' min · '+money(s.price)+' · '+(s.active?"Activo":"Inactivo")+'</span>'+
        '<div class="admin-actions"><button class="btn secondary small" onclick="editService(\''+s.id+'\')">Editar</button>'+
        '<button class="btn '+(s.active?"secondary":"secondary")+' small" onclick="toggleService(\''+s.id+'\')">'+(s.active?"Desactivar":"Activar")+'</button>'+
        '<button class="btn danger small" onclick="deleteService(\''+s.id+'\')">Eliminar</button></div></div>';
    }).join("");
  }
  if(proEl){
    proEl.innerHTML=pros.map(function(p){
      return '<div class="admin-item"><strong>'+escapeHtml(p.name)+'</strong>'+
        '<span style="color:'+(p.active?"#7fd394":"#c78f8f")+'">'+(p.active?"Activo":"Inactivo")+'</span>'+
        '<div class="admin-actions"><button class="btn secondary small" onclick="togglePro(\''+p.id+'\')">'+(p.active?"Desactivar":"Activar")+'</button></div></div>';
    }).join("");
  }
  if($("barshiWa")) $("barshiWa").value=db.wa.number||"";
  if($("reminder")) $("reminder").value=db.wa.reminder||"24 horas antes";
  if($("bookingHorizon")) $("bookingHorizon").value=String((db.settings&&db.settings.bookingHorizon)||30);
  if($("minimumNotice")) $("minimumNotice").value=String((db.settings&&db.settings.minimumNotice)||30);
  const bp=$("blockProfessional");
  if(bp){
    const current=bp.value;
    bp.innerHTML='<option value="">Todo el local</option>'+pros.filter(function(p){return p.active;}).map(function(p){return '<option value="'+p.id+'">'+escapeHtml(p.name)+'</option>';}).join("");
    bp.value=current;
  }

  const manualService=$("manualVisitService");
  if(manualService){
    const current=manualService.value;
    manualService.innerHTML=services.map(function(s){return '<option value="'+s.id+'">'+escapeHtml(s.name)+(s.active?"":" (inactivo)")+'</option>';}).join("");
    if(current && services.some(function(s){return String(s.id)===String(current);})) manualService.value=current;
  }
  const manualPro=$("manualVisitPro");
  if(manualPro){
    const current=manualPro.value;
    manualPro.innerHTML=pros.map(function(p){return '<option value="'+p.id+'">'+escapeHtml(p.name)+(p.active?"":" (inactivo)")+'</option>';}).join("");
    if(current && pros.some(function(p){return String(p.id)===String(current);})) manualPro.value=current;
  }
  const manualDate=$("manualVisitDate");
  if(manualDate){
    const today=new Date();
    manualDate.max=dateKey(today);
    if(!manualDate.value){
      const yesterday=new Date(today);
      yesterday.setDate(today.getDate()-1);
      manualDate.value=dateKey(yesterday);
    }
  }

  const historyPro=$("historyProfessional");
  if(historyPro){
    const current=historyPro.value;
    historyPro.innerHTML='<option value="">Todos</option>'+pros.map(function(p){return '<option value="'+p.id+'">'+escapeHtml(p.name)+'</option>';}).join("");
    historyPro.value=current;
  }
}
window.addService=async function(){
  const n=$("newServiceName").value.trim();
  const p=parsePrice($("newServicePrice").value);
  const d=Number($("newServiceDuration").value);
  const desc=$("newServiceDesc").value.trim();
  if(!n || !Number.isFinite(p) || !d) return alert("Completá nombre, precio y duración.");
  if(cloud){
    const res=await supa.from("services").insert({name:n,price:p,duration_minutes:d,description:desc,active:true});
    if(res.error) return alert("No se pudo guardar el servicio.");
    await loadAdminData(); await loadPublicData();
  }else{
    db.services.push({id:Date.now(),name:n,price:p,duration:d,desc:desc,active:true}); saveLocal();
  }
  ["newServiceName","newServicePrice","newServiceDuration","newServiceDesc"].forEach(function(id){$(id).value="";});
  renderAll();
};
window.editService=async function(id){
  const list=cloud&&adminReady?cloudAllServices:db.services;
  const s=list.find(function(x){return String(x.id)===String(id);});
  if(!s) return;
  const n=prompt("Nombre del servicio",s.name); if(n===null) return;
  const p=prompt("Precio",String(s.price)); if(p===null) return;
  const d=prompt("Duración en minutos",String(s.duration)); if(d===null) return;
  const desc=prompt("Descripción",s.desc||""); if(desc===null) return;
  const price=parsePrice(p), dur=Number(d);
  if(!n.trim() || !Number.isFinite(price) || !dur) return alert("Revisá los datos.");
  if(cloud){
    const res=await supa.from("services").update({name:n.trim(),price:price,duration_minutes:dur,description:desc.trim(),updated_at:new Date().toISOString()}).eq("id",id);
    if(res.error) return alert("No se pudo actualizar.");
    await loadAdminData(); await loadPublicData();
  }else{
    Object.assign(s,{name:n.trim(),price:price,duration:dur,desc:desc.trim()}); saveLocal();
  }
  renderAll();
};
window.toggleService=async function(id){
  const list=cloud&&adminReady?cloudAllServices:db.services;
  const s=list.find(function(x){return String(x.id)===String(id);}); if(!s) return;
  if(cloud){
    const res=await supa.from("services").update({active:!s.active,updated_at:new Date().toISOString()}).eq("id",id);
    if(res.error) return alert("No se pudo actualizar.");
    await loadAdminData(); await loadPublicData();
  }else{ s.active=!s.active; saveLocal(); }
  renderAll();
};
window.deleteService=async function(id){
  const list=cloud&&adminReady?cloudAllServices:db.services;
  const s=list.find(function(x){return String(x.id)===String(id);});
  if(!s) return;
  if(!confirm('¿Eliminar "'+s.name+'"? Esta acción no se puede deshacer.')) return;
  if(cloud){
    const res=await supa.from("services").delete().eq("id",id);
    if(res.error){
      if(String(res.error.message||"").toLowerCase().includes("foreign key")){
        alert("Este servicio tiene turnos asociados y debe conservarse en el historial. Podés desactivarlo para que no aparezca al reservar.");
      }else{
        alert("No se pudo eliminar el servicio.");
      }
      return;
    }
    await loadAdminData(); await loadPublicData();
  }else{
    db.services=db.services.filter(function(x){return String(x.id)!==String(id);});
    saveLocal();
  }
  renderAll();
};
window.addPro=async function(){
  const n=$("newProName").value.trim();
  const active=$("newProActive").value==="1";
  if(!n) return alert("Ingresá el nombre.");
  if(cloud){
    const res=await supa.from("professionals").insert({name:n,active:active});
    if(res.error) return alert("No se pudo guardar el profesional.");
    await loadAdminData(); await loadPublicData();
  }else{
    db.pros.push({id:Date.now(),name:n,active:active}); saveLocal();
  }
  $("newProName").value="";
  renderAll();
};
window.togglePro=async function(id){
  const list=cloud&&adminReady?cloudAllPros:db.pros;
  const p=list.find(function(x){return String(x.id)===String(id);}); if(!p) return;
  if(cloud){
    const res=await supa.from("professionals").update({active:!p.active,updated_at:new Date().toISOString()}).eq("id",id);
    if(res.error) return alert("No se pudo actualizar.");
    await loadAdminData(); await loadPublicData();
  }else{ p.active=!p.active; saveLocal(); }
  renderAll();
};
function whatsappClientNumber(v){
  let d=String(v||"").replace(/\D/g,"");
  if(d.startsWith("00")) d=d.slice(2);
  if(d.startsWith("54")) return d;
  // Argentina: para WhatsApp internacional, anteponemos 549 a números locales de 10 dígitos.
  if(d.length===10) return "549"+d;
  return d;
}
function appointmentDateTime(a){
  return new Date(String(a.appointment_date)+"T"+String(a.appointment_time).slice(0,8));
}
function reminderHoursValue(){
  return parseInt(String(db.wa&&db.wa.reminder||"24"),10)||24;
}
function reminderIsDue(a){
  if(!a || a.status!=="confirmed") return false;
  const diff=(appointmentDateTime(a).getTime()-Date.now())/3600000;
  return diff>=0 && diff<=reminderHoursValue();
}
function composeConfirmation(a){
  const service=a.services&&a.services.name?a.services.name:"tu servicio";
  const pro=a.professionals&&a.professionals.name?a.professionals.name:"Barshi";
  const address=[db.settings&&db.settings.address,db.settings&&db.settings.city].filter(Boolean).join(", ");
  const clubToken=a.clients&&a.clients.club_access_token;
  const clubLink=clubToken ? location.origin.replace(/\/$/,"")+"/club.html?t="+clubToken : "";
  return "Hola "+String(a.client_name||"").trim().split(/\s+/)[0]+" 👋\n\nTe confirmamos tu turno en Barshi.\n\n✂️ "+service+"\n📅 "+formatDate(a.appointment_date)+"\n🕒 "+String(a.appointment_time).slice(0,5)+"\n👤 "+pro+(address?"\n📍 "+address:"")+(clubLink?"\n\nTu acceso privado a Mi Club Barshi:\n"+clubLink:"")+"\n\n¡Te esperamos!";
}
function composeReminder(a){
  const service=a.services&&a.services.name?a.services.name:"tu servicio";
  const pro=a.professionals&&a.professionals.name?a.professionals.name:"Barshi";
  const address=[db.settings&&db.settings.address,db.settings&&db.settings.city].filter(Boolean).join(", ");
  return "Hola "+String(a.client_name||"").trim().split(/\s+/)[0]+" 👋\n\nTe recordamos tu turno en Barshi.\n\n✂️ "+service+"\n📅 "+formatDate(a.appointment_date)+"\n🕒 "+String(a.appointment_time).slice(0,5)+"\n👤 "+pro+(address?"\n📍 "+address:"")+"\n\n¡Te esperamos!";
}
function openClientWhatsApp(a,message){
  const n=whatsappClientNumber(a.client_whatsapp);
  if(!n || n.length<10) return alert("Revisá el número de WhatsApp del cliente.");
  window.open("https://wa.me/"+n+"?text="+encodeURIComponent(message),"_blank","noopener");
}
window.sendConfirmationWhatsApp=function(id){
  const a=(cloudAppointments||[]).find(function(x){return String(x.id)===String(id);});
  if(!a) return alert("No encontramos ese turno.");
  openClientWhatsApp(a,composeConfirmation(a));
};
window.sendReminderWhatsApp=function(id){
  const a=(cloudAppointments||[]).find(function(x){return String(x.id)===String(id);});
  if(!a) return alert("No encontramos ese turno.");
  openClientWhatsApp(a,composeReminder(a));
};
function renderAdminAgenda(){
  const el=$("adminAgenda"); if(!el) return;
  if(cloud && adminReady){
    const goal=Math.max(2,Number(db.settings&&db.settings.clubGoal)||10);
    const paidTarget=goal-1;
    const today=dateKey(new Date());

    function appointmentCard(a){
      const service=a.services && a.services.name ? a.services.name : "Servicio";
      const pro=a.professionals && a.professionals.name ? a.professionals.name : "Profesional";
      const dur=Number(a.duration_minutes||30);
      const client=a.clients||{};
      const stamps=Number(client.stamps||0);
      const reward=!!client.reward_available;
      let loyalty=reward
        ? '<div class="loyalty-meta"><span class="status-pill reward">Beneficio disponible</span></div>'
        : '<div class="loyalty-meta">Club: '+stamps+' de '+paidTarget+' visitas validadas</div>';
      if(reminderIsDue(a)) loyalty+='<div class="loyalty-meta"><span class="status-pill reward">Recordatorio recomendado</span></div>';

      let actions='<div class="appt-actions">';
      if(a.status==="confirmed"){
        actions += reward
          ? '<button class="btn primary small" onclick="redeemReward(\''+a.id+'\')">Canjear beneficio</button>'
          : '<button class="btn primary small" onclick="validateVisit(\''+a.id+'\')">Validar visita</button>';
        actions += '<button class="btn secondary small" onclick="sendConfirmationWhatsApp(\''+a.id+'\')">Confirmar por WhatsApp</button>';
        actions += '<button class="btn '+(reminderIsDue(a)?"primary":"secondary")+' small" onclick="sendReminderWhatsApp(\''+a.id+'\')">Recordatorio</button>';
        actions += '<button class="btn secondary small" onclick="shareClub(\''+a.id+'\')">Enviar Mi Club</button>';
        actions += '<button class="btn danger small" onclick="cancelAppointment(\''+a.id+'\')">Cancelar</button>';
      }else if(a.status==="completed"){
        actions += '<button class="btn secondary small" onclick="shareClub(\''+a.id+'\')">Enviar Mi Club</button>';
        actions += '<span class="status-pill ok">Atendido</span>';
      }else if(a.status==="cancelled"){
        actions += '<span class="status-pill">Cancelado</span>';
      }else{
        actions += '<span class="status-pill">'+escapeHtml(a.status)+'</span>';
      }
      actions+='</div>';

      return '<div class="appt"><b>'+formatDate(a.appointment_date)+'</b><b>'+String(a.appointment_time).slice(0,5)+'</b><div><strong>'+escapeHtml(a.client_name)+'</strong><div class="muted">'+escapeHtml(service)+' · '+dur+' min · '+escapeHtml(pro)+' · '+escapeHtml(a.client_whatsapp)+'</div>'+loyalty+'</div>'+actions+'</div>';
    }

    const upcoming=cloudAppointments.filter(function(a){
      return a.appointment_date>=today && a.status==="confirmed";
    }).sort(function(x,y){
      return (x.appointment_date+String(x.appointment_time)).localeCompare(y.appointment_date+String(y.appointment_time));
    });

    const history=cloudAppointments.filter(function(a){
      return !(a.appointment_date>=today && a.status==="confirmed");
    }).sort(function(x,y){
      return (y.appointment_date+String(y.appointment_time)).localeCompare(x.appointment_date+String(x.appointment_time));
    });

    let html='';
    html+='<div class="section-title" style="margin-top:4px"><h3>Próximos turnos</h3><span>'+upcoming.length+'</span></div>';
    html+=upcoming.length?upcoming.map(appointmentCard).join(""):'<div class="notice">No hay próximos turnos confirmados.</div>';

    html+='<div class="section-title" style="margin-top:22px"><h3>Historial reciente</h3><span>Últimos 30 días</span></div>';
    html+=history.length?history.map(appointmentCard).join(""):'<div class="notice">Todavía no hay visitas recientes.</div>';

    el.innerHTML=html;
    return;
  }

  const arr=(db.appointments||[]).filter(function(a){return a.status!=="cancelled";}).sort(function(a,b){return (a.date+a.time).localeCompare(b.date+b.time);});
  el.innerHTML=arr.length ? arr.map(function(a){
    const dur=Number(a.duration||30);
    return '<div class="appt"><b>'+formatDate(a.date)+'</b><b>'+a.time+'</b><div><strong>'+escapeHtml(a.name)+'</strong><div class="muted">'+escapeHtml(a.service)+' · '+dur+' min · '+escapeHtml(a.pro)+' · '+escapeHtml(a.wa)+'</div></div><button class="btn danger small" onclick="cancelAppointment(\''+a.id+'\')">Cancelar</button></div>';
  }).join("") : '<div class="notice">Todavía no hay turnos registrados en este navegador.</div>';
}

window.renderAdminHistory=function(){
  const el=$("adminHistory");
  if(!el) return;
  const search=String($("historySearch")&&$("historySearch").value||"").trim().toLowerCase();
  const proId=String($("historyProfessional")&&$("historyProfessional").value||"");
  const goal=Math.max(2,Number(db.settings&&db.settings.clubGoal)||10);
  const paidTarget=goal-1;

  let rows=(cloud&&adminReady ? cloudHistory : (db.appointments||[]).filter(function(a){return a.status==="completed";})).slice();

  rows=rows.filter(function(a){
    const name=String(a.client_name||a.name||"").toLowerCase();
    const wa=String(a.client_whatsapp||a.wa||"").toLowerCase();
    const p=String(a.professional_id||a.proId||"");
    return (!search || name.includes(search) || wa.includes(search))
      && (!proId || p===proId);
  });

  rows.sort(function(x,y){
    const ax=(x.appointment_date||x.date||"")+" "+String(x.appointment_time||x.time||"");
    const by=(y.appointment_date||y.date||"")+" "+String(y.appointment_time||y.time||"");
    return by.localeCompare(ax);
  });

  const count=$("historyCount");
  if(count) count.textContent=rows.length+" "+(rows.length===1?"visita":"visitas");

  if(!rows.length){
    el.innerHTML='<div class="notice">No encontramos visitas atendidas con esos filtros.</div>';
    return;
  }

  const head='<div class="history-row history-head"><div>Fecha</div><div>Hora</div><div>Cliente</div><div>Servicio</div><div>Profesional</div><div>Club</div></div>';
  const body=rows.map(function(a){
    const client=a.clients||{};
    const stamps=Number(client.stamps||0);
    const reward=!!client.reward_available;
    const service=a.services&&a.services.name ? a.services.name : (a.service||"Servicio");
    const pro=a.professionals&&a.professionals.name ? a.professionals.name : (a.pro||"Profesional");
    const date=a.appointment_date||a.date||"";
    const time=String(a.appointment_time||a.time||"").slice(0,5);
    const name=a.client_name||a.name||"Cliente";
    const wa=a.client_whatsapp||a.wa||"";
    const clubText=reward ? "Beneficio disponible" : stamps+" de "+paidTarget+" sellos";
    return '<div class="history-row">'+
      '<div class="history-cell" data-label="Fecha"><b>'+formatDate(date)+'</b></div>'+
      '<div class="history-cell" data-label="Hora"><b>'+escapeHtml(time)+'</b></div>'+
      '<div class="history-client"><strong>'+escapeHtml(name)+'</strong><small>'+escapeHtml(wa)+'</small></div>'+
      '<div class="history-cell" data-label="Servicio">'+escapeHtml(service)+'</div>'+
      '<div class="history-cell" data-label="Profesional">'+escapeHtml(pro)+'</div>'+
      '<div class="history-cell history-stamps" data-label="Club">'+escapeHtml(clubText)+'</div>'+
    '</div>';
  }).join("");

  el.innerHTML=head+body;
};

window.registerManualVisit=async function(){
  if(!cloud || !adminReady) return alert("Necesitás ingresar al panel administrativo.");
  const name=$("manualVisitName").value.trim();
  const wa=$("manualVisitWa").value.trim();
  const serviceId=$("manualVisitService").value;
  const proId=$("manualVisitPro").value;
  const date=$("manualVisitDate").value;
  const time=$("manualVisitTime").value || "12:00";

  if(!name || !wa || !serviceId || !proId || !date){
    return alert("Completá nombre, WhatsApp, servicio, profesional y fecha.");
  }

  if(!confirm("¿Registrar esta visita como atendida y sumar su sello del Club Barshi?")) return;

  const btn=document.querySelector('button[onclick="registerManualVisit()"]');
  if(btn){btn.disabled=true;btn.textContent="Registrando…";}

  const res=await supa.rpc("register_manual_visit",{
    p_client_name:name,
    p_client_whatsapp:wa,
    p_service_id:serviceId,
    p_professional_id:proId,
    p_date:date,
    p_time:time
  });

  if(btn){btn.disabled=false;btn.textContent="Registrar visita y sumar sello";}

  if(res.error){
    return alert(res.error.message||"No se pudo registrar la visita.");
  }

  const row=(res.data||[])[0]||{};
  $("manualVisitName").value="";
  $("manualVisitWa").value="";
  const yesterday=new Date();
  yesterday.setDate(yesterday.getDate()-1);
  $("manualVisitDate").value=dateKey(yesterday);
  $("manualVisitTime").value="12:00";

  await loadAdminData();

  if(row.reward_available){
    alert("Visita registrada. El cliente ya tiene disponible su beneficio del Club Barshi.");
  }else{
    alert("Visita registrada y sello agregado. Ahora tiene "+Number(row.stamps||0)+" sello(s).");
  }
};

function normalizeClientWhatsapp(v){
  let d=String(v||"").replace(/\D/g,"");
  if(d.startsWith("00")) d=d.slice(2);
  if(d.startsWith("54")) return d;
  if(d.length===10) return "549"+d;
  return d;
}
window.shareClub=function(id){
  const appt=(cloudAppointments||[]).find(function(x){return String(x.id)===String(id);});
  if(!appt) return alert("No encontramos ese turno.");
  const token=appt.clients&&appt.clients.club_access_token;
  if(!token) return alert("Todavía no hay un enlace de Club disponible para este cliente.");
  const base=location.origin.replace(/\/$/,"");
  const link=base+"/club.html?t="+token;
  const first=String(appt.client_name||"").trim().split(/\s+/)[0]||"";
  const msg="Hola "+first+" 👋\n\nTe dejamos tu acceso privado a Mi Club Barshi. Desde acá podés ver tus sellos reales, tu beneficio y tu próximo turno:\n\n"+link+"\n\nGuardalo, porque es tu enlace personal.";
  const number=normalizeClientWhatsapp(appt.client_whatsapp);
  if(number && number.length>=10){
    window.open("https://wa.me/"+number+"?text="+encodeURIComponent(msg),"_blank","noopener");
  }else if(navigator.clipboard){
    navigator.clipboard.writeText(link).then(function(){alert("Copiamos el enlace de Mi Club. Podés enviárselo por WhatsApp.");});
  }else{
    prompt("Copiá este enlace y envialo al cliente:",link);
  }
};
window.validateVisit=async function(id){
  if(!confirm("¿Confirmar que el cliente fue atendido? Esto sumará un sello al Club Barshi.")) return;
  const res=await supa.rpc("validate_appointment_visit",{p_appointment_id:id});
  if(res.error) return alert(res.error.message||"No se pudo validar la visita.");
  const row=(res.data||[])[0]||{};
  await loadAdminData();
  if(row.reward_available){
    alert("Visita validada. El cliente ya tiene disponible su beneficio del Club Barshi.");
  }else{
    alert("Visita validada. Sello agregado.");
  }
};
window.redeemReward=async function(id){
  if(!confirm("¿Canjear el beneficio del Club Barshi en este turno? Los sellos se reiniciarán.")) return;
  const res=await supa.rpc("redeem_appointment_reward",{p_appointment_id:id});
  if(res.error) return alert(res.error.message||"No se pudo canjear el beneficio.");
  await loadAdminData();
  alert("Beneficio canjeado. El contador de sellos volvió a cero.");
};
window.cancelAppointment=async function(id){
  if(!confirm("¿Cancelar este turno?")) return;
  if(cloud){
    const res=await supa.from("appointments").update({status:"cancelled"}).eq("id",id);
    if(res.error) return alert("No se pudo cancelar.");
    await loadAdminData();
  }else{
    const a=(db.appointments||[]).find(function(x){return String(x.id)===String(id);});
    if(a){a.status="cancelled";saveLocal();}
  }
  renderAdminAgenda();
  if(booking.date) refreshSlots();
};
window.saveWa=async function(){
  const number=$("barshiWa").value.trim();
  const reminder=$("reminder").value;
  const hours=parseInt(reminder,10)||24;
  if(cloud){
    const res=await supa.from("settings").update({whatsapp_business:number,reminder_hours:hours,updated_at:new Date().toISOString()}).eq("id",1);
    if(res.error) return alert("No se pudo guardar la configuración.");
    await loadPublicData();
  }else{
    db.wa.number=number;db.wa.reminder=reminder;saveLocal();
  }
  alert("Configuración guardada.");
};


function renderClubPublic(){
  const s=db.settings||{};
  const section=$("clubSection");
  if(section) section.classList.toggle("hidden",s.clubEnabled===false);
  if($("clubLabel")) $("clubLabel").textContent=s.clubLabel||"CLUB BARSHI";
  if($("clubTitle")) $("clubTitle").textContent=s.clubTitle||"";
  if($("clubLegend")) $("clubLegend").textContent=s.clubLegend||"";
  const stamps=$("clubStamps");
  if(stamps){
    const goal=Math.max(2,Math.min(50,Number(s.clubGoal)||10));
    let html="";
    for(let i=1;i<goal;i++) html+='<div class="stamp"><img src="'+CLUB_STAMP_LOGO+'" alt="" aria-hidden="true"><span>'+i+'</span></div>';
    html+='<div class="stamp reward-stamp"><img src="'+CLUB_STAMP_LOGO+'" alt="" aria-hidden="true"><span>'+escapeHtml(s.clubRewardText||"GRATIS")+'</span></div>';
    stamps.style.gridTemplateColumns='repeat(auto-fit,minmax(56px,1fr))';
    stamps.innerHTML=html;
  }
  const badge=document.querySelector(".badges .club-badge");
  if(badge){
    badge.textContent="★ "+(s.clubBadgeText||"");
    badge.classList.toggle("hidden",s.clubEnabled===false || !s.clubBadgeText);
  }
  const promos=(db.promotions||[]).filter(function(p){return p.active!==false;});
  const promoSection=$("promotionsSection"), promoGrid=$("publicPromotions");
  if(promoSection) promoSection.classList.toggle("hidden",promos.length===0);
  if(promoGrid) promoGrid.innerHTML=promos.map(function(p){
    return '<article class="promo-card"><h4>'+escapeHtml(p.title)+'</h4><p>'+escapeHtml(p.description||"")+'</p></article>';
  }).join("");
}
function renderClubAdmin(){
  const s=db.settings||{};
  if($("clubEnabled")) $("clubEnabled").checked=s.clubEnabled!==false;
  if($("clubLabelInput")) $("clubLabelInput").value=s.clubLabel||"";
  if($("clubTitleInput")) $("clubTitleInput").value=s.clubTitle||"";
  if($("clubLegendInput")) $("clubLegendInput").value=s.clubLegend||"";
  if($("clubGoal")) $("clubGoal").value=String(s.clubGoal||10);
  if($("clubRewardText")) $("clubRewardText").value=s.clubRewardText||"";
  if($("clubBadgeText")) $("clubBadgeText").value=s.clubBadgeText||"";
}
window.saveClubSettings=async function(){
  const payload={
    club_enabled:$("clubEnabled").checked,
    club_label:$("clubLabelInput").value.trim()||"CLUB BARSHI",
    club_title:$("clubTitleInput").value.trim(),
    club_legend:$("clubLegendInput").value.trim(),
    club_goal:Math.max(2,Math.min(50,Number($("clubGoal").value)||10)),
    club_reward_text:$("clubRewardText").value.trim()||"GRATIS",
    club_badge_text:$("clubBadgeText").value.trim(),
    updated_at:new Date().toISOString()
  };
  if(cloud){
    const res=await supa.from("settings").update(payload).eq("id",1);
    if(res.error) return alert("No se pudo guardar el Club Barshi.");
    await loadAdminData(); await loadPublicData();
  }else{
    Object.assign(db.settings,{
      clubEnabled:payload.club_enabled,clubLabel:payload.club_label,clubTitle:payload.club_title,
      clubLegend:payload.club_legend,clubGoal:payload.club_goal,clubRewardText:payload.club_reward_text,
      clubBadgeText:payload.club_badge_text
    });
    saveLocal();
  }
  renderAll();
  alert("Club Barshi actualizado.");
};
function renderPromotionsAdmin(){
  const el=$("adminPromotions"); if(!el) return;
  const promos=cloud&&adminReady?cloudPromotions:(db.promotions||[]);
  el.innerHTML=promos.length ? promos.map(function(p){
    return '<div class="admin-item"><strong>'+escapeHtml(p.title)+'</strong>'+
      '<span style="color:var(--muted)">'+escapeHtml(p.description||"")+'</span>'+
      '<div class="admin-actions"><button class="btn secondary small" onclick="editPromotion(\''+p.id+'\')">Editar</button>'+
      '<button class="btn secondary small" onclick="togglePromotion(\''+p.id+'\')">'+(p.active?"Ocultar":"Publicar")+'</button>'+
      '<button class="btn danger small" onclick="deletePromotion(\''+p.id+'\')">Eliminar</button></div></div>';
  }).join("") : '<div class="notice">No hay promociones adicionales cargadas.</div>';
}
window.addPromotion=async function(){
  const title=$("newPromoTitle").value.trim();
  const description=$("newPromoDesc").value.trim();
  const active=$("newPromoActive").value==="1";
  if(!title) return alert("Escribí el título de la promoción.");
  if(cloud){
    const res=await supa.from("promotions").insert({title:title,description:description,active:active});
    if(res.error) return alert("No se pudo agregar la promoción.");
    await loadAdminData(); await loadPublicData();
  }else{
    db.promotions.push({id:Date.now(),title:title,description:description,active:active});saveLocal();
  }
  $("newPromoTitle").value="";$("newPromoDesc").value="";
  renderAll();
};
window.editPromotion=async function(id){
  const list=cloud&&adminReady?cloudPromotions:(db.promotions||[]);
  const p=list.find(function(x){return String(x.id)===String(id);}); if(!p) return;
  const title=prompt("Título de la promoción",p.title); if(title===null) return;
  const description=prompt("Descripción / condiciones",p.description||""); if(description===null) return;
  if(!title.trim()) return alert("El título no puede quedar vacío.");
  if(cloud){
    const res=await supa.from("promotions").update({title:title.trim(),description:description.trim(),updated_at:new Date().toISOString()}).eq("id",id);
    if(res.error) return alert("No se pudo actualizar.");
    await loadAdminData(); await loadPublicData();
  }else{
    p.title=title.trim();p.description=description.trim();saveLocal();
  }
  renderAll();
};
window.togglePromotion=async function(id){
  const list=cloud&&adminReady?cloudPromotions:(db.promotions||[]);
  const p=list.find(function(x){return String(x.id)===String(id);}); if(!p) return;
  if(cloud){
    const res=await supa.from("promotions").update({active:!p.active,updated_at:new Date().toISOString()}).eq("id",id);
    if(res.error) return alert("No se pudo actualizar.");
    await loadAdminData(); await loadPublicData();
  }else{p.active=!p.active;saveLocal();}
  renderAll();
};
window.deletePromotion=async function(id){
  if(!confirm("¿Eliminar esta promoción?")) return;
  if(cloud){
    const res=await supa.from("promotions").delete().eq("id",id);
    if(res.error) return alert("No se pudo eliminar.");
    await loadAdminData(); await loadPublicData();
  }else{
    db.promotions=(db.promotions||[]).filter(function(p){return String(p.id)!==String(id);});saveLocal();
  }
  renderAll();
};

function applyPublicBusinessInfo(){
  const s=db.settings||{};
  const name=s.businessName||"Barshi Barber";
  const address=[s.address,s.city].filter(Boolean).join(" · ");
  document.title=name+" · Turnos";
  if($("headerAddress")) $("headerAddress").textContent=address;
  if($("brandLogo")){
    $("brandLogo").alt=name;
    $("brandLogo").src=s.logoUrl || defaultLogoSrc || $("brandLogo").src;
  }
  if($("footerBusiness")) $("footerBusiness").textContent=name+" · "+address+" · "+hoursSummary();
}
function dayName(n){
  return ["","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"][Number(n)]||"";
}
function shortDay(n){
  return ["","Lun","Mar","Mié","Jue","Vie","Sáb","Dom"][Number(n)]||"";
}
function hoursSummary(){
  const open=(db.businessHours||[]).filter(function(h){return h.is_open;});
  if(!open.length) return "Agenda cerrada";
  const groups=[];
  open.forEach(function(h){
    const key=h.open_time+"-"+h.close_time;
    let g=groups.find(function(x){return x.key===key;});
    if(!g){g={key:key,days:[],open:h.open_time,close:h.close_time};groups.push(g);}
    g.days.push(Number(h.day_of_week));
  });
  return groups.map(function(g){
    const ds=g.days;
    let label=ds.length>1 && ds.every(function(v,i){return i===0||v===ds[i-1]+1;})
      ? shortDay(ds[0])+" a "+shortDay(ds[ds.length-1])
      : ds.map(shortDay).join(", ");
    return label+" · "+String(g.open).slice(0,5)+"–"+String(g.close).slice(0,5);
  }).join(" / ");
}
function renderBusinessForm(){
  const s=db.settings||{};
  if($("businessName")) $("businessName").value=s.businessName||"";
  if($("businessTagline")) $("businessTagline").value=s.tagline||"";
  if($("businessAddress")) $("businessAddress").value=s.address||"";
  if($("businessCity")) $("businessCity").value=s.city||"";
  if($("businessLogoPreview")) $("businessLogoPreview").src=s.logoUrl || defaultLogoSrc || ($("brandLogo")&&$("brandLogo").src) || "";
}
function renderHoursEditor(){
  const el=$("businessHoursEditor"); if(!el) return;
  const hours=(db.businessHours||[]).slice().sort(function(x,y){return x.day_of_week-y.day_of_week;});
  el.innerHTML=hours.map(function(h){
    const d=h.day_of_week;
    return '<div class="hours-row" data-day="'+d+'">'+
      '<label>'+dayName(d)+'</label>'+
      '<label class="open-toggle"><input class="hours-open" type="checkbox" '+(h.is_open?"checked":"")+' onchange="toggleHourRow('+d+')"> Abierto</label>'+
      '<input class="hours-from" type="time" value="'+String(h.open_time).slice(0,5)+'" '+(!h.is_open?"disabled":"")+' aria-label="Apertura '+dayName(d)+'">'+
      '<input class="hours-to" type="time" value="'+String(h.close_time).slice(0,5)+'" '+(!h.is_open?"disabled":"")+' aria-label="Cierre '+dayName(d)+'">'+
    '</div>';
  }).join("");
}
window.toggleHourRow=function(day){
  const row=document.querySelector('.hours-row[data-day="'+day+'"]'); if(!row) return;
  const open=row.querySelector(".hours-open").checked;
  row.querySelector(".hours-from").disabled=!open;
  row.querySelector(".hours-to").disabled=!open;
};
window.saveBusinessHours=async function(){
  const rows=Array.from(document.querySelectorAll(".hours-row"));
  const horizon=Number($("bookingHorizon").value||30);
  const notice=Number($("minimumNotice").value||30);
  try{
    const payload=rows.map(function(row){
      const day=Number(row.dataset.day);
      const isOpen=row.querySelector(".hours-open").checked;
      const from=row.querySelector(".hours-from").value || "09:00";
      const to=row.querySelector(".hours-to").value || "20:00";
      if(isOpen && timeToMinutes(to)<=timeToMinutes(from)) throw new Error(dayName(day)+": el cierre debe ser posterior a la apertura.");
      return {day_of_week:day,is_open:isOpen,open_time:from,close_time:to,updated_at:new Date().toISOString()};
    });
    if(cloud){
      const r1=await supa.from("business_hours").upsert(payload,{onConflict:"day_of_week"});
      if(r1.error) throw r1.error;
      const r2=await supa.from("settings").update({booking_horizon_days:horizon,minimum_notice_minutes:notice,updated_at:new Date().toISOString()}).eq("id",1);
      if(r2.error) throw r2.error;
      await loadAdminData(); await loadPublicData();
    }else{
      db.businessHours=payload.map(mapHour);
      db.settings.bookingHorizon=horizon;db.settings.minimumNotice=notice;saveLocal();
    }
    renderAll(); alert("Horarios actualizados.");
  }catch(e){ alert(e.message||"No se pudieron guardar los horarios."); }
};
window.toggleBlockTimeFields=function(){
  const full=$("blockAllDay").checked;
  $("blockStart").disabled=full; $("blockEnd").disabled=full;
  if(full){$("blockStart").value="";$("blockEnd").value="";}
};
function renderScheduleBlocks(){
  const el=$("scheduleBlocksList"); if(!el) return;
  const arr=cloud&&adminReady ? cloudScheduleBlocks : (db.scheduleBlocks||[]);
  el.innerHTML=arr.length ? arr.map(function(b){
    const whole=!b.start_time&&!b.end_time;
    const when=whole ? "Día completo" : String(b.start_time).slice(0,5)+"–"+String(b.end_time).slice(0,5);
    const pro=b.professionals&&b.professionals.name ? b.professionals.name : (b.professional_name||"Todo el local");
    return '<div class="block-item"><b>'+formatDate(b.block_date)+'</b><div><strong>'+escapeHtml(when)+' · '+escapeHtml(pro)+'</strong><div class="muted">'+escapeHtml(b.reason||"Bloqueo de agenda")+'</div></div><button class="btn danger small" onclick="deleteScheduleBlock(\''+b.id+'\')">Eliminar</button></div>';
  }).join("") : '<div class="notice">No hay cierres o bloqueos próximos.</div>';
}
window.addScheduleBlock=async function(){
  const date=$("blockDate").value;
  const pro=$("blockProfessional").value || null;
  const full=$("blockAllDay").checked;
  const start=full?null:$("blockStart").value;
  const end=full?null:$("blockEnd").value;
  const reason=$("blockReason").value.trim();
  if(!date) return alert("Elegí una fecha.");
  if(!full && (!start||!end||timeToMinutes(end)<=timeToMinutes(start))) return alert("Revisá el horario del bloqueo.");
  const payload={block_date:date,professional_id:pro,start_time:start,end_time:end,reason:reason};
  if(cloud){
    const res=await supa.from("schedule_blocks").insert(payload);
    if(res.error) return alert("No se pudo bloquear la agenda.");
    await loadAdminData();
  }else{
    db.scheduleBlocks=db.scheduleBlocks||[];
    db.scheduleBlocks.push(Object.assign({id:Date.now()},payload));saveLocal();
  }
  $("blockReason").value=""; $("blockDate").value=""; $("blockAllDay").checked=true; toggleBlockTimeFields();
  renderScheduleBlocks();
};
window.deleteScheduleBlock=async function(id){
  if(!confirm("¿Eliminar este bloqueo de agenda?")) return;
  if(cloud){
    const res=await supa.from("schedule_blocks").delete().eq("id",id);
    if(res.error) return alert("No se pudo eliminar.");
    await loadAdminData();
  }else{
    db.scheduleBlocks=(db.scheduleBlocks||[]).filter(function(b){return String(b.id)!==String(id);});saveLocal();
  }
  renderScheduleBlocks();
};
function compressLogo(file){
  return new Promise(function(resolve,reject){
    if(!file || !file.type.startsWith("image/")) return reject(new Error("Elegí una imagen válida."));
    if(file.size>5*1024*1024) return reject(new Error("El archivo es demasiado grande. Máximo 5 MB."));
    const reader=new FileReader();
    reader.onload=function(){
      const img=new Image();
      img.onload=function(){
        const maxW=900,maxH=500;
        const scale=Math.min(1,maxW/img.width,maxH/img.height);
        const canvas=document.createElement("canvas");
        canvas.width=Math.max(1,Math.round(img.width*scale));
        canvas.height=Math.max(1,Math.round(img.height*scale));
        const ctx=canvas.getContext("2d");
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL("image/webp",0.88));
      };
      img.onerror=function(){reject(new Error("No pudimos procesar la imagen."));};
      img.src=reader.result;
    };
    reader.onerror=function(){reject(new Error("No pudimos leer el archivo."));};
    reader.readAsDataURL(file);
  });
}
window.saveBusinessInfo=async function(){
  const name=$("businessName").value.trim();
  const tagline=$("businessTagline").value.trim();
  const address=$("businessAddress").value.trim();
  const city=$("businessCity").value.trim();
  if(!name||!address||!city) return alert("Completá nombre, dirección y ciudad.");
  let logo=(db.settings&&db.settings.logoUrl)||"";
  const file=$("businessLogoFile").files[0];
  try{
    if(file) logo=await compressLogo(file);
    if(cloud){
      const res=await supa.from("settings").update({
        business_name:name,tagline:tagline,address:address,city:city,logo_url:logo,updated_at:new Date().toISOString()
      }).eq("id",1);
      if(res.error) throw res.error;
      await loadAdminData(); await loadPublicData();
    }else{
      Object.assign(db.settings,{businessName:name,tagline:tagline,address:address,city:city,logoUrl:logo});saveLocal();
    }
    if($("businessLogoFile")) $("businessLogoFile").value="";
    renderAll(); alert("Datos del negocio actualizados.");
  }catch(e){alert(e.message||"No se pudieron guardar los datos.");}
};

document.addEventListener("DOMContentLoaded",init);
})();
