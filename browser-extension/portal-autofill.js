(async () => {
  "use strict";
  if (window.__FFM_AUTOFILL_RUNNING__) return;
  window.__FFM_AUTOFILL_RUNNING__ = true;
  const { ffmPendingAutofill: payload } = await chrome.storage.local.get("ffmPendingAutofill");
  if (payload && (!payload.createdAt || Date.now() - payload.createdAt > 3 * 60 * 60 * 1000)) {
    await chrome.storage.local.remove("ffmPendingAutofill");
    alert("Form Fill Mitra: This application handoff expired for privacy. Return to Final Review and create a fresh handoff.");
    window.__FFM_AUTOFILL_RUNNING__ = false; return;
  }
  if (!payload || !payload.applicant || !payload.answers) {
    alert("Form Fill Mitra: No saved application data. Return to Form Fill Mitra and complete Final Review.");
    window.__FFM_AUTOFILL_RUNNING__ = false; return;
  }
  const norm = value => String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g,"$1_$2")
    .toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"")
    .replace(/[^a-z0-9\\u0900-\\u097f]+/g,"_").replace(/^_+|_+$/g,"");
  const data = { ...(payload.applicant || {}), ...(payload.answers || {}) };
  const dataEntries = Object.entries(data).map(([key,value]) => [norm(key),value]);
  const lookupData = key => {
    const normalized = norm(key);
    const entry = dataEntries.find(([candidate]) => candidate === normalized);
    return entry ? entry[1] : undefined;
  };
  const aliasGroups = {
    full_name:["full_name","fullname","name","applicant_name","candidate_name","आवेदक_का_नाम","आवेदिका_का_नाम"],
    father_name:["father_name","fathername","guardian_name","पिता_का_नाम"],
    mother_name:["mother_name","mothername","माता_का_नाम"],
    husband_name:["husband_name","husbandname","पति_का_नाम"],
    mobile:["mobile","mobile_number","phone","phone_number","contact_number","मोबाइल_नंबर","मोबाइल_संख्या"],
    email:["email","email_address","ईमेल"],
    dob:["dob","date_of_birth","dateofbirth","birth_date","birthdate","जन्म_तिथि"],
    state:["state","state_name","राज्य"], district:["district","district_name","जिला"],
    subdivision:["subdivision","sub_division","अनुमंडल"], block:["block","प्रखंड","खंड"],
    ward:["ward","ward_no","वार्ड_संख्या"], village:["village","town","village_town","ग्राम","मोहल्ला"],
    post:["post_office","डाकघर"], police:["police_station","थाना"],
    pincode:["pin","pincode","pin_code","postal_code","पिन_कोड"],
    gender:["gender","sex","लिंग"], category:["category","caste_category","श्रेणी"],
    address:["address","full_address","complete_address","permanent_address","present_address","पता"]
  };
  function resolveProfileValue(key, label, autofill) {
    for (const candidate of [key,autofill,label]) {
      const direct = lookupData(candidate);
      if (direct != null && String(direct).trim()) return direct;
    }
    const normalizedCandidates = [norm(key),norm(autofill),norm(label)].filter(Boolean);
    for (const [group,aliases] of Object.entries(aliasGroups)) {
      const normalizedAliases = aliases.map(norm);
      if (normalizedCandidates.some(candidate => normalizedAliases.includes(candidate) || candidate === norm(group))) {
        for (const alias of [group,...aliases]) {
          const value = lookupData(alias);
          if (value != null && String(value).trim()) return value;
        }
      }
    }
    return undefined;
  }
  const aliases = {
    name:["applicant name","name of applicant","candidate name","name of candidate","full name","applicant full name","आवेदक का नाम","आवेदिका का नाम"],
    father:["father name","name of father","father full name","पिता का नाम","पिता"],
    mother:["mother name","name of mother","mother full name","माता का नाम","माता"],
    husband:["husband name","name of husband","पति का नाम"],
    mobile:["mobile","mobile number","phone","contact number","मोबाइल संख्या","मोबाइल नंबर"],
    email:["email","email address","ईमेल"],
    dob:["date of birth","dob","birth date","जन्म तिथि"],
    state:["state","राज्य"], district:["district","जिला"], subdivision:["sub division","subdivision","अनुमंडल"],
    block:["block","प्रखंड","खंड"], ward:["ward","ward no","वार्ड संख्या"], village:["village","town","village town","ग्राम","मोहल्ला"],
    post:["post office","डाकघर"], police:["police station","थाना"], pincode:["pin code","pincode","postal code","पिन कोड"],
    gender:["gender","sex","लिंग"], category:["category","caste category","श्रेणी"], address:["address","full address","पता"]
  };
  const fieldDefs = Array.isArray(payload.fields) ? payload.fields : [];
  function findValue(el) {
    const idname = norm([el.name,el.id,el.getAttribute("placeholder"),el.getAttribute("aria-label")].filter(Boolean).join(" "));
    const labels = [];
    if (el.labels) for (const label of el.labels) labels.push(label.innerText || label.textContent || "");
    const parent = el.closest("label"); if(parent) labels.push(parent.innerText || parent.textContent || "");
    const prev = el.previousElementSibling; if(prev && /^(LABEL|SPAN|DIV|P)$/.test(prev.tagName)) labels.push(prev.innerText || prev.textContent || "");
    const text = norm(labels.join(" "));
    const candidates = [idname,text].filter(Boolean);
    // Exact normalized profile/answer keys must win before broad alias matching.
    for (const k of Object.keys(data)) {
      if (candidates.includes(norm(k)) && data[k] != null && String(data[k]).trim()) return data[k];
    }
    // Admin-defined field keys and labels have priority, then standard aliases.
    for (const def of fieldDefs) {
      const key = norm(def.key || def.name || "");
      const label = norm(def.label || def.name || "");
      if (candidates.some(c => c === key || c === label || (key && c.includes(key)) || (label && c.includes(label)))) {
        const val = resolveProfileValue(def.key || def.name, def.label || def.name, def.autofill || def.autofillKey || "");
        if (val != null && String(val).trim()) return val;
      }
    }
    for (const [group,names] of Object.entries(aliases)) {
      if (names.some(a => candidates.some(c => c === norm(a) || c.includes(norm(a))))) {
        const value = resolveProfileValue(group, text, "");
        if (value != null && String(value).trim()) return value;
      }
    }
    return undefined;
  }
  function setNativeValue(el,value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype :
      el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto,"value")?.set;
    if (setter) setter.call(el,String(value)); else el.value=String(value);
    el.dispatchEvent(new Event("input",{bubbles:true}));
    el.dispatchEvent(new Event("change",{bubbles:true}));
  }
  const controls = [...document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file]):not([type=password]),select,textarea")]
    .filter(el => !el.disabled && el.getClientRects().length);
  let filled=0, unmatched=0, invalid=0;
  const matched=[];
  for (const el of controls) {
    const value=findValue(el);
    if (value === undefined) { if(el.required) unmatched++; continue; }
    if (el.type === "checkbox" || el.type === "radio") {
      const desired=norm(value);
      const optionText=norm(el.value+" "+(el.labels?.[0]?.innerText||""));
      if (desired === norm("true") || desired === norm("yes") || desired === norm("1") || desired===optionText || optionText.includes(desired)) {
        el.checked=true; el.dispatchEvent(new Event("input",{bubbles:true})); el.dispatchEvent(new Event("change",{bubbles:true})); filled++; matched.push({el, expected: true});
      } else { unmatched++; }
    } else if (el.tagName === "SELECT") {
      const wanted=norm(value);
      const findOption=()=> {
        let option=[...el.options].find(o=>norm(o.value)===wanted && norm(o.value));
        if(!option) option=[...el.options].find(o=>norm(o.text)===wanted && norm(o.text));
        if(!option && wanted.length>1) option=[...el.options].find(o=>norm(o.text).length>1 && (norm(o.text).includes(wanted) || wanted.includes(norm(o.text))));
        return option;
      };
      let option=findOption();
      // Some portals load District/Block options after the parent selection.
      for(let retry=0;!option && retry<8 && el.required;retry++){
        await new Promise(resolve=>setTimeout(resolve,250));
        option=findOption();
      }
      if(option){setNativeValue(el,option.value);filled++;matched.push({el, expected: option.value});await new Promise(resolve=>setTimeout(resolve,120));} else if(el.required) unmatched++;
    } else {
      let val=String(value);
      if(el.type==="date" && !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
        const m=val.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); if(m) val=m[3]+"-"+m[2].padStart(2,"0")+"-"+m[1].padStart(2,"0");
      }
      setNativeValue(el,val);
      if(el.checkValidity && !el.checkValidity()) invalid++;
      filled++; matched.push({el, expected: val});
    }
  }
  // Re-check the actual DOM values after events; never submit or bypass security steps.
  const verified=matched.filter(({el,expected})=>{
    if(el.type==="checkbox"||el.type==="radio") return el.checked === Boolean(expected);
    return norm(el.value) === norm(expected);
  }).length;
  const mismatched=matched.length-verified;
  const report=document.createElement("section");
  report.style.cssText="position:fixed;z-index:2147483647;top:12px;right:12px;max-width:min(360px,92vw);background:#fff;color:#172033;border:2px solid #2563eb;border-radius:12px;padding:14px;box-shadow:0 8px 32px #0003;font:14px Arial;max-height:70vh;overflow:auto";
  report.innerHTML="<strong>Form Fill Mitra — Portal Check</strong><p>Fields filled: "+filled+"<br>Values verified in page: "+verified+"<br>Values mismatched after re-read: "+mismatched+"<br>Required fields unmatched: "+unmatched+"<br>Browser validation warnings: "+invalid+"</p><p>Review every field. Dependent dropdowns may need manual selection. CAPTCHA, OTP, payment and submit are never automated.</p><button type='button' style='padding:8px 12px'>Close report</button>";
  report.querySelector("button").onclick=()=>report.remove();
  document.body.appendChild(report);
  window.__FFM_AUTOFILL_DONE__=true;
  window.__FFM_AUTOFILL_RUNNING__=false;
})();