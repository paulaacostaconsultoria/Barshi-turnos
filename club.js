(function(){
"use strict";
const $=id=>document.getElementById(id);
let supa=null,settings=null;

function cfg(){
  const c=window.BARSHI_SUPABASE||{};
  return {url:c.url||"https://vzpeofhmqrumcgwzwkkr.supabase.co",key:c.publishableKey||"sb_publishable_p8C4f1CPFc5nSn7c-zVTHA_qYzcLYzn"};
}
function show(id){
  ["loadingCard","noTokenCard","invalidCard","clubContent"].forEach(x=>$(x)&&$(x).classList.toggle("hidden",x!==id));
}
function fmtDate(d,t){
  if(!d)return "";
  const [y,m,day]=d.split("-");
  return day+"/"+m+" · "+String(t||"").slice(0,5);
}
function normalizeWa(v){
  let d=String(v||"").replace(/\D/g,"");
  if(d.startsWith("00"))d=d.slice(2);
  if(d.startsWith("54"))return d;
  if(d.length===10)return "549"+d;
  return d;
}
async function loadSettings(){
  const r=await supa.from("settings").select("business_name,address,city,whatsapp_business").eq("id",1).maybeSingle();
  if(!r.error&&r.data){
    settings=r.data;
    $("businessName").textContent=r.data.business_name||"Barshi Barber";
    $("businessAddress").textContent=[r.data.address,r.data.city].filter(Boolean).join(" · ");
  }
}
window.requestClubLink=function(){
  const n=normalizeWa(settings&&settings.whatsapp_business);
  const msg=encodeURIComponent("Hola, quiero mi enlace privado de Mi Club Barshi.");
  if(n) window.open("https://wa.me/"+n+"?text="+msg,"_blank","noopener");
  else alert("Pedí tu enlace de Mi Club directamente en Barshi.");
};
function validUuid(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v||"");}
function renderClub(row){
  $("clubLabel").textContent=row.club_label||"CLUB BARSHI";
  $("helloTitle").textContent="Hola, "+(row.client_name||"")+" 👋";
  $("clubTitle").textContent=row.club_title||"";
  $("clubLegend").textContent=row.club_legend||"";
  const goal=Math.max(2,Number(row.club_goal)||10), stamps=Math.max(0,Number(row.stamps)||0), reward=!!row.reward_available;
  let html="";
  for(let i=1;i<goal;i++){
    html+='<div class="stamp '+(i<=stamps?"done":"")+'"><img src="./assets/barshi-isotipo.svg" alt="" aria-hidden="true"><span>'+i+'</span></div>';
  }
  html+='<div class="stamp reward '+(reward?"done":"")+'"><img src="./assets/barshi-isotipo.svg" alt="" aria-hidden="true"><span>'+String(row.club_reward_text||"GRATIS")+'</span></div>';
  $("clubStamps").innerHTML=html;
  $("clubProgress").textContent=reward?"Beneficio listo para usar.":stamps+" de "+(goal-1)+" visitas validadas";
  $("rewardBanner").classList.toggle("hidden",!reward);

  if(row.next_date){
    $("nextAppointmentCard").classList.remove("hidden");
    $("nextService").textContent=row.next_service||"Próximo turno";
    $("nextProfessional").textContent=(row.next_professional?"Con "+row.next_professional:"");
    $("nextDate").textContent=fmtDate(row.next_date,row.next_time);
  }else{
    $("nextAppointmentCard").classList.add("hidden");
  }
}
async function init(){
  const c=cfg();
  supa=window.supabase.createClient(c.url,c.key);
  await loadSettings();
  const token=new URLSearchParams(location.search).get("t");
  if(!token){show("noTokenCard");return;}
  if(!validUuid(token)){show("invalidCard");return;}
  const r=await supa.rpc("get_club_status",{p_token:token});
  if(r.error||!r.data||!r.data.length){show("invalidCard");return;}
  renderClub(r.data[0]);
  show("clubContent");
}
document.addEventListener("DOMContentLoaded",init);
})();