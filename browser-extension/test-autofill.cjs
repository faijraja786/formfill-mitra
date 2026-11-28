const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

class BaseControl {
  constructor({name="",id="",label="",value="",type="text",required=false,tag="INPUT",placeholder=""}={}) {
    this.name=name; this.id=id; this.type=type; this.tagName=tag; this.required=required;
    this.disabled=false; this.labels=label?[{innerText:label,textContent:label}]:[];
    this.previousElementSibling=null; this._value=value; this.placeholder=placeholder;
  }
  get value(){return this._value;}
  set value(v){this._value=String(v);}
  getAttribute(name){return name==="placeholder"?this.placeholder:name==="aria-label"?"":null;}
  getClientRects(){return [{}];}
  closest(){return null;}
  dispatchEvent(){return true;}
  checkValidity(){return true;}
}
class HTMLInputElement extends BaseControl {}
class HTMLTextAreaElement extends BaseControl {}
class HTMLSelectElement extends BaseControl {
  constructor(opts={}){super({...opts,tag:"SELECT"});this.options=opts.options||[];}
  set value(v){this._value=String(v);}
  get value(){return this._value;}
}

async function run() {
  const controls = [
    new HTMLInputElement({name:"applicantName",label:"Name of Applicant",required:true}),
    new HTMLInputElement({name:"fatherName",label:"Name of Father",required:true}),
    new HTMLInputElement({name:"guardianCustom",label:"Guardian Name",required:true}),
    new HTMLSelectElement({name:"state",label:"State",required:true,options:[{value:"",text:"Please Select"},{value:"BR",text:"Bihar"},{value:"UP",text:"Uttar Pradesh"}]})
  ];
  const report = {style:{},innerHTML:"",querySelector(){return {onclick:null};}};
  const payload = {
    version:1,createdAt:Date.now(),formName:"Test form",officialLink:"https://test.example/form",
    applicant:{fullName:"Asha Kumari",fatherName:"Ramesh Kumar",mobileNumber:"9876543210",state:"Bihar"},
    answers:{},
    fields:[{key:"guardianCustom",label:"Guardian Name",autofill:"fatherName",required:true}]
  };
  const context = {
    chrome:{storage:{local:{get:async()=>({ffmPendingAutofill:payload}),remove:async()=>{}}}},
    document:{querySelectorAll:()=>controls,createElement:()=>report,body:{appendChild(){}}},
    window:{},alert(){},Event:class Event{constructor(type,opts){this.type=type;this.bubbles=opts?.bubbles;}},
    HTMLInputElement,HTMLTextAreaElement,HTMLSelectElement,
    setTimeout,clearTimeout,console
  };
  vm.runInNewContext(fs.readFileSync("browser-extension/portal-autofill.js","utf8"),context);
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(controls[0].value,"Asha Kumari","camelCase fullName should fill applicant name");
  assert.equal(controls[1].value,"Ramesh Kumar","fatherName alias should fill father field");
  assert.equal(controls[2].value,"Ramesh Kumar","admin autofill key should map profile value");
  assert.equal(controls[3].value,"BR","select should match visible option text and set option value");
  assert.match(report.innerHTML,/Values verified in page: 4/,"all values should be re-read and verified");
  assert.match(report.innerHTML,/Required fields unmatched: 0/,"all required test fields should match");
  console.log("PASS portal autofill mapping + select + re-read verification");
}
run().catch(error=>{console.error(error);process.exitCode=1;});
