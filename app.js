
(function(){
"use strict";

const $ = (id) => document.getElementById(id);
const LOCAL_KEY = "barshi-db";
const OPEN_MIN = 9*60;
const CLOSE_MIN = 20*60;
const SLOT_STEP = 15;
const CLEANING_BUFFER = 15;

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
  wa:{number:"",reminder:"24 horas antes"},
  settings:{openTime:"09:00",closeTime:"20:00",slotStep:15}
};

let db = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null") || JSON.parse(JSON.stringify(defaults));
let booking = {service:null,pro:null,date:"",time:"",name:"",wa:""};
let supa = null;
let cloud = false;
let adminReady = false;
let cloudSlots = [];
let cloudAppointments = [];
let cloudAllServices = [];
let cloudAllPros = [];

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
function cloudConfigured(){
  const c = window.BARSHI_SUPABASE || {};
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
  for(let i=0;out.length<10 && i<25;i++){
    const x=new Date(d);
    x.setDate(d.getDate()+i);
    const wd=x.getDay();
    if(wd>=2 && wd<=6) out.push(x);
  }
  return out;
}

async function init(){
  if(cloudConfigured()){
    const c=window.BARSHI_SUPABASE;
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
      supa.from("settings").select("*").eq("id",1).maybeSingle()
    ]);
    if(results[0].error) throw results[0].error;
    if(results[1].error) throw results[1].error;
    db.services=(results[0].data||[]).map(mapService);
    db.pros=(results[1].data||[]).map(mapPro);
    if(results[2].data){
      db.wa.number=results[2].data.whatsapp_business || "";
      db.wa.reminder=String(results[2].data.reminder_hours || 24)+" horas antes";
      db.settings={
        openTime:String(results[2].data.open_time||"09:00").slice(0,5),
        closeTime:String(results[2].data.close_time||"20:00").slice(0,5),
        slotStep:Number(results[2].data.slot_step_minutes||15)
      };
    }
  }catch(e){
    console.error("Supabase public load failed",e);
    cloud=false;
  }
}

function renderAll(){
  renderServices();
  renderPros();
  renderAdmin();
  renderAgendaPicker();
  renderAdminAgenda();
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
    const open=timeToMinutes((db.settings&&db.settings.openTime)||"09:00");
    const close=timeToMinutes((db.settings&&db.settings.closeTime)||"20:00");
    for(let m=open;m<close;m+=SLOT_STEP){
      const t=String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");
      if(!slotUnavailableLocal(booking.date,t)) available.add(t);
    }
    renderSlotButtons(available,false);
  }
  if(hint) hint.textContent=booking.time ? "Turno seleccionado: "+formatDate(booking.date)+" a las "+booking.time+"." : "Elegí uno de los horarios disponibles.";
}
function renderSlotButtons(available,fromCloud){
  const slots=$("slotGrid");
  const open=timeToMinutes((db.settings&&db.settings.openTime)||"09:00");
  const close=timeToMinutes((db.settings&&db.settings.closeTime)||"20:00");
  const step=(db.settings&&db.settings.slotStep)||SLOT_STEP;
  let out=[];
  for(let m=open;m<close;m+=step){
    const t=String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");
    const ok=available.has(t);
    out.push('<button class="slot '+(!ok?"busy":"")+' '+(booking.time===t?"sel":"")+'" '+(!ok?"disabled":'onclick="pickTime(\''+t+'\')"')+'>'+t+'</button>');
  }
  slots.innerHTML=out.join("");
}
function slotUnavailableLocal(day,time){
  if(!booking.service) return true;
  const duration=Number(booking.service.duration)||30;
  const start=timeToMinutes(time);
  const close=timeToMinutes((db.settings&&db.settings.closeTime)||"20:00");
  if(start+duration+CLEANING_BUFFER>close) return true;
  const now=new Date();
  if(day===dateKey(now) && start<=now.getHours()*60+now.getMinutes()) return true;
  if(booking.pro==="any"){
    return !(db.pros||[]).some(function(p){return p.active && !professionalBusyLocal(p.id,day,time,duration);});
  }
  return !booking.pro || professionalBusyLocal(booking.pro.id,day,time,duration);
}
function professionalBusyLocal(proId,day,time,duration){
  return (db.appointments||[]).some(function(a){
    if(a.date!==day || a.status==="cancelled") return false;
    if(a.proId!=null && String(a.proId)!==String(proId)) return false;
    return intervalsOverlap(time,duration+CLEANING_BUFFER,a.time,Number(a.duration||30)+CLEANING_BUFFER);
  });
}
window.pickDay=function(k){ booking.date=k; booking.time=""; renderAgendaPicker(); };
window.pickTime=function(t){ booking.time=t; renderAgendaPicker(); };

window.confirmBooking=async function(){
  const nameEl=$("name"), waEl=$("wa");
  if(!nameEl.value.trim() || !waEl.value.trim()) return alert("Completá nombre y WhatsApp.");
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
  renderAll(); go(1);
};

async function verifyAdmin(userId){
  if(!cloud) return true;
  const res=await supa.from("admin_users").select("user_id").eq("user_id",userId).maybeSingle();
  return !res.error && !!res.data;
}
window.openAdmin=async function(){
  if(!cloud){
    showAuth("La administración segura todavía no está conectada a la base de datos. Falta configurar Supabase.");
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
  ["services","pros","agenda","whatsapp"].forEach(function(x){
    const el=$("tab-"+x); if(el) el.classList.toggle("hidden",x!==id);
  });
  document.querySelectorAll(".tab").forEach(function(x){x.classList.remove("on");});
  if(btn) btn.classList.add("on");
  if(id==="agenda") renderAdminAgenda();
};

async function loadAdminData(){
  if(!cloud || !adminReady) return;
  const results=await Promise.all([
    supa.from("services").select("*").order("sort_order"),
    supa.from("professionals").select("*").order("name"),
    supa.from("appointments")
      .select("id,appointment_date,appointment_time,duration_minutes,status,client_name,client_whatsapp,service_id,professional_id,services(name),professionals(name)")
      .gte("appointment_date",dateKey(new Date()))
      .order("appointment_date",{ascending:true})
      .order("appointment_time",{ascending:true})
  ]);
  if(!results[0].error) cloudAllServices=(results[0].data||[]).map(mapService);
  if(!results[1].error) cloudAllPros=(results[1].data||[]).map(mapPro);
  if(!results[2].error) cloudAppointments=results[2].data||[];
  renderAdmin();
  renderAdminAgenda();
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
        '<button class="btn '+(s.active?"danger":"secondary")+' small" onclick="toggleService(\''+s.id+'\')">'+(s.active?"Desactivar":"Activar")+'</button></div></div>';
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
function renderAdminAgenda(){
  const el=$("adminAgenda"); if(!el) return;
  if(cloud && adminReady){
    el.innerHTML=cloudAppointments.length ? cloudAppointments.map(function(a){
      const service=a.services && a.services.name ? a.services.name : "Servicio";
      const pro=a.professionals && a.professionals.name ? a.professionals.name : "Profesional";
      const dur=Number(a.duration_minutes||30);
      return '<div class="appt"><b>'+formatDate(a.appointment_date)+'</b><b>'+String(a.appointment_time).slice(0,5)+'</b><div><strong>'+escapeHtml(a.client_name)+'</strong><div class="muted">'+escapeHtml(service)+' · '+dur+' min · ocupado hasta '+endTimeLabel(a.appointment_time,dur)+' · '+escapeHtml(pro)+' · '+escapeHtml(a.client_whatsapp)+'</div></div><button class="btn danger small" onclick="cancelAppointment(\''+a.id+'\')">Cancelar</button></div>';
    }).join("") : '<div class="notice">No hay turnos próximos.</div>';
    return;
  }
  const arr=(db.appointments||[]).filter(function(a){return a.status!=="cancelled";}).sort(function(a,b){return (a.date+a.time).localeCompare(b.date+b.time);});
  el.innerHTML=arr.length ? arr.map(function(a){
    const dur=Number(a.duration||30);
    return '<div class="appt"><b>'+formatDate(a.date)+'</b><b>'+a.time+'</b><div><strong>'+escapeHtml(a.name)+'</strong><div class="muted">'+escapeHtml(a.service)+' · '+dur+' min · ocupado hasta '+endTimeLabel(a.time,dur)+' · '+escapeHtml(a.pro)+' · '+escapeHtml(a.wa)+'</div></div><button class="btn danger small" onclick="cancelAppointment(\''+a.id+'\')">Cancelar</button></div>';
  }).join("") : '<div class="notice">Todavía no hay turnos registrados en este navegador.</div>';
}
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

document.addEventListener("DOMContentLoaded",init);
})();
