import { auth } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { apiRequest } from "./api-client.js";

const DB_NAME = "FormFillMitraDB";
const STORE_NAME = "documents";
const list = document.getElementById("docList");
const status = document.getElementById("status");
const form = document.getElementById("uploadForm");
const saveBtn = document.getElementById("saveBtn");
const labels = {
  identity_proof:"Identity Proof", address_proof:"Address Proof", photograph:"Photograph",
  signature:"Signature", education:"Education Document", caste_certificate:"Caste Certificate",
  income_proof:"Income Supporting Document", other:"Other Supporting Document"
};
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let currentUser = null;

function openDB() {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME,{keyPath:"id"});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function getAllLocal() {
  const db = await openDB();
  return new Promise((resolve,reject) => {
    const tx=db.transaction(STORE_NAME,"readonly"), request=tx.objectStore(STORE_NAME).getAll();
    request.onsuccess=()=>{db.close();resolve(request.result||[]);};
    request.onerror=()=>{db.close();reject(request.error);};
  });
}
async function putLocal(record) {
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE_NAME,"readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete=()=>{db.close();resolve();};
    tx.onerror=()=>{db.close();reject(tx.error);};
  });
}
async function deleteLocal(id) {
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE_NAME,"readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete=()=>{db.close();resolve();};
    tx.onerror=()=>{db.close();reject(tx.error);};
  });
}
async function load() {
  try {
    const docs=(await getAllLocal()).filter(d=>d.ownerUid===currentUser.uid && String(d.id).startsWith("vault_"));
    if(!docs.length){list.innerHTML='<div class="empty">No documents saved in this browser yet. Import any older server-saved documents below.</div>';return;}
    list.innerHTML=docs.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))).map(d=>'<article class="doc"><div>📄 '+esc(labels[d.documentKey]||"Supporting Document")+'</div><h3>'+esc(d.name||"Document")+'</h3><small>'+Math.max(1,Math.round((d.size||0)/1024))+' KB · Saved on this device</small><div class="actions"><button data-download="'+esc(d.id)+'">Download</button><button data-delete="'+esc(d.id)+'">Delete</button></div></article>').join("");
    list.querySelectorAll("[data-download]").forEach(b=>b.onclick=()=>downloadLocal(b.dataset.download));
    list.querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>removeLocal(b.dataset.delete));
  } catch(e) { list.innerHTML='<div class="empty">'+esc(e.message||"Local documents could not be loaded.")+'</div>'; }
}
async function downloadLocal(id) {
  const record=(await getAllLocal()).find(d=>d.id===id && d.ownerUid===currentUser.uid);
  if(!record||!(record.file instanceof Blob)){alert("The local file is missing. Please import or upload it again.");return;}
  const url=URL.createObjectURL(record.file),a=document.createElement("a");
  a.href=url;a.download=record.name||"document";a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
async function removeLocal(id) {
  if(!confirm("Delete this document from this browser only?"))return;
  await deleteLocal(id);await load();
}
form.addEventListener("submit",async e=>{
  e.preventDefault();const file=document.getElementById("documentFile").files[0];if(!file)return;
  if(file.size>10*1024*1024){status.textContent="File must be 10 MB or smaller.";return;}
  const allowed=["application/pdf","image/jpeg","image/png","image/webp"];
  if(!allowed.includes(file.type)){status.textContent="Only PDF, JPG, PNG and WEBP files are supported.";return;}
  saveBtn.disabled=true;status.textContent="Saving to this browser…";
  try{
    const documentKey=document.getElementById("documentKey").value;
    await putLocal({id:"vault_"+currentUser.uid+"_"+crypto.randomUUID(),ownerUid:currentUser.uid,documentKey,name:file.name,type:file.type,size:file.size,file,createdAt:new Date().toISOString()});
    form.reset();status.textContent="Saved on this device only. It is not uploaded to the Form Fill Mitra server.";
    await load();
  }catch(e){status.textContent=e.message||"Could not save locally. Check browser storage space.";}
  finally{saveBtn.disabled=false;}
});
async function migrateServerVault() {
  if(!confirm("Import old saved documents into this browser, then delete each server copy only after its local copy is saved? Keep this page open until migration finishes."))return;
  const button=document.getElementById("migrateBtn");button.disabled=true;status.textContent="Checking old server documents…";
  try{
    const response=await apiRequest("/api/my-documents"),docs=response.documents||[];
    if(!docs.length){status.textContent="No old server documents were found.";return;}
    let migrated=0;
    for(const doc of docs){
      const url="https://form-fill-mitra-api.onrender.com/api/my-documents/"+encodeURIComponent(doc.id)+"/download";
      const download=await fetch(url,{headers:{Authorization:"Bearer "+await currentUser.getIdToken()}});
      if(!download.ok)throw new Error("Could not download "+(doc.name||"a saved file")+" from the server. No server copy was deleted for this file.");
      const blob=await download.blob();
      await putLocal({id:"vault_"+currentUser.uid+"_"+doc.id,ownerUid:currentUser.uid,serverId:doc.id,documentKey:doc.documentKey,name:doc.name,type:doc.mimeType||blob.type,size:doc.size||blob.size,file:blob,createdAt:doc.createdAt||new Date().toISOString()});
      try{await apiRequest("/api/my-documents/"+encodeURIComponent(doc.id),{method:"DELETE"});}catch(deleteError){status.textContent="Local copy saved, but server deletion failed for "+(doc.name||"a file")+". It may remain duplicated on the server; retry migration later.";throw deleteError;}
      migrated++;
    }
    status.textContent="Imported "+migrated+" document(s) to this browser and removed their server copies.";
    await load();
  }catch(e){status.textContent=e.message||"Migration stopped. Existing server copies were not intentionally removed before local save.";}
  finally{button.disabled=false;}
}
document.getElementById("refreshBtn").onclick=load;
document.getElementById("migrateBtn").onclick=migrateServerVault;
onAuthStateChanged(auth,async user=>{
  if(!user){location.replace("personal-login.html");return;}
  currentUser=user;
  try{const me=await apiRequest("/api/me");if(me.profile.role!=="personal"){location.replace(me.profile.role==="professional"?"professional-dashboard.html":"index.html");return;}await load();}
  catch(e){status.textContent=e.message||"Sign in to manage local documents.";}
});
