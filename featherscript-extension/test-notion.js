// Mixed Notion transcript: anchored user turns and block-root assistant turns.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function element(text='',order=0){
  const attrs={},children=[];
  const node={nodeType:1,tagName:'DIV',style:{},isConnected:true,offsetParent:{},parentElement:null,children,
    get textContent(){return text;},getAttribute:key=>attrs[key]??null,hasAttribute:key=>key in attrs,
    matches:selector=>selector==='[data-agent-service-scroll-anchor]'?'data-agent-service-scroll-anchor' in attrs:selector==="[data-content-editable-root='true']"?attrs['data-content-editable-root']==='true':false,
    closest:()=>null,contains:other=>children.includes(other),querySelectorAll:()=>[],querySelector:selector=>selector==='[data-block-id]'?children.find(child=>child.hasAttribute?.('data-block-id')):null,
    compareDocumentPosition:other=>order>other.order?2:4,order,attrs,
  };
  const leaf={nodeType:3,nodeValue:text,nextSibling:null};node.firstChild=leaf;return node;
}
const user=element('Starting up',0);user.attrs['data-agent-service-scroll-anchor']='user:1';user.style.justifyContent='flex-end';
const userRoot=element('Starting up',1);userRoot.attrs['data-content-editable-root']='true';userRoot.parentElement=user;user.children.push(userRoot);
const assistant=element("I'm ready to work in your Roblox Studio project. What should I do?",2);assistant.attrs['data-content-editable-root']='true';
for(const node of [userRoot,assistant]){const block=element(node.textContent,node.order);block.attrs['data-block-id']='block-'+node.order;node.children.push(block);}
const body=element();const doc={body,querySelectorAll:selector=>selector==='[data-agent-service-scroll-anchor]'?[user]:selector==="[data-content-editable-root='true']"?[userRoot,assistant]:[],querySelector:()=>null};
const context={document:doc,location:{pathname:'/chat/fixture',search:''},getComputedStyle:node=>node.style,Date,URLSearchParams,innerHeight:800,setTimeout,clearTimeout};
const P=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'providers/notion.js'),'utf8')+';ZSProvider;',context);
assert.equal(P.allItems().length,2,'mixed transcript must include both rows without duplicating the anchored user');
assert.equal(P.assistantCount(),1,'block-root assistant cannot disappear just because the user row has an anchor');
assert.equal(P.userCount(),1);
assert.match(P.readAssistant().reply,/ready to work/);
assert.equal(P.lastAssistant(),assistant);
console.log('PASS Notion mixed transcript discovers the startup reply without duplicating anchored turns');
