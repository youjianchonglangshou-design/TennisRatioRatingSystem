
const table=document.querySelector('table.main');
const tbody=table?table.tBodies[0]:null;
const card=document.getElementById('card');
const statusLine=document.getElementById('job-status');
const statusText=document.getElementById('status-text');
const pageRevision=Number(document.body.dataset.revision||0);
let closeTimer=null;
let runInitiated=false;
if(table)table.querySelectorAll('th:not([data-nosort])').forEach(th=>th.addEventListener('click',()=>{
 const index=th.cellIndex;
 const desc=th.classList.contains('asc'); table.querySelectorAll('th').forEach(x=>x.classList.remove('asc','desc')); th.classList.add(desc?'desc':'asc');
 const rows=[...tbody.rows]; rows.sort((a,b)=>{let x=a.cells[index].dataset.sort||'',y=b.cells[index].dataset.sort||''; if(th.dataset.type==='number'){x=Number(x);y=Number(y)} return (x<y?-1:x>y?1:0)*(desc?-1:1)}); rows.forEach(row=>tbody.appendChild(row));
}));
let activeFilter='全部';
function applyFilters(){
 if(!tbody)return;
 const needle=document.getElementById('search-box').value.trim().toLocaleLowerCase('zh-Hant');
 let visible=0;
 [...tbody.rows].forEach(row=>{
  const rowRating=row.dataset.rating||'';
  const isColdCandidate=(row.dataset.coldCandidate||'0')==='1';
  const ratingOK=activeFilter==='全部'
   || (activeFilter==='冷門方' ? isColdCandidate : (rowRating===activeFilter||rowRating.includes(activeFilter)));
  const searchOK=!needle||(row.dataset.search||'').includes(needle);
  row.hidden=!(ratingOK&&searchOK);
  if(!row.hidden)visible+=1;
 });
 document.getElementById('visible-count').textContent=`顯示 ${visible}／${tbody.rows.length} 場`;
 document.getElementById('empty-filter').style.display=visible?'none':'block';
}
document.querySelectorAll('.filter-chip').forEach(button=>button.addEventListener('click',()=>{
 activeFilter=button.dataset.filter||'全部';
 document.querySelectorAll('.filter-chip').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',active?'true':'false')});
 applyFilters();
}));
document.getElementById('search-box').addEventListener('input',applyFilters);
function setRunning(running){
 document.querySelectorAll('.run-button').forEach(button=>button.disabled=running);
 statusLine.classList.toggle('running',running);
 if(chatToggle){chatToggle.disabled=running||document.body.dataset.analysisReady!=='1';chatToggle.title=running?'分析進行中，Gemini暫不可用':'分析資料已載入，可開啟Gemini問答'}
 if(running&&drawer?.classList.contains('open'))setDrawer(false);
}
async function readStatus(){
 statusText.textContent='第一階段視覺移植版：尚未接入全JS分析管線。';
 statusLine.classList.remove('running','error');
 setRunning(false);
}
document.querySelectorAll('.run-button').forEach(button=>button.addEventListener('click',()=>{
 statusLine.classList.remove('running','error');
 const mode=button.dataset.mode==='full'?'重新抓取＋完整分析':'只重跑目前清單';
 statusText.textContent=`${mode}：此按鈕已保留原位，將在後續階段接入全JS分析引擎。`;
}));
function fitIntegratedCardToContent(){
 if(!card.classList.contains('integrated-card'))return;
 let statsRequired=Number(getComputedStyle(card).getPropertyValue('--stats-pane-min').replace('px',''))||430;
 card.querySelectorAll('.stats-tab-panel.active .compare-table').forEach(table=>{
  statsRequired=Math.max(statsRequired,Math.ceil(table.scrollWidth+6));
 });
 const bo3Names=[...card.querySelectorAll('.bo3-player-name')];
 if(bo3Names.length>=2){
  const bo3Required=bo3Names.slice(0,2).reduce((total,node)=>total+Math.ceil(node.scrollWidth)+32,18);
  statsRequired=Math.max(statsRequired,bo3Required);
 }
  statsRequired=Math.min(920,Math.max(430,statsRequired));
 card.style.setProperty('--stats-pane-min',statsRequired+'px');
 const formula=card.querySelector('.formula-section');
 const formulaRequired=Math.max(680,formula?Math.ceil(formula.scrollWidth):680);
 const measuredWidth=statsRequired+formulaRequired+36;
 const templateWidth=Number(card.dataset.desiredWidth||1260);
 card.dataset.desiredWidth=String(Math.min(1780,Math.max(templateWidth,measuredWidth)));
}
function placeCard(target){const r=target.getBoundingClientRect(),gap=10;if(card.classList.contains('integrated-card')){const desired=Number(card.dataset.desiredWidth||1080),w=Math.min(desired,window.innerWidth-16);card.style.width=w+'px';card.style.maxWidth='none';let left=r.left-w-gap;if(left<8)left=8;if(left+w>window.innerWidth-8)left=window.innerWidth-w-8;card.style.left=Math.max(8,left)+'px';const h=card.offsetHeight;let top=r.bottom+gap;if(top+h>window.innerHeight-8)top=Math.max(8,r.top-h-gap);card.style.top=top+'px';return}const w=card.offsetWidth,h=card.offsetHeight;let left=Math.min(window.innerWidth-w-8,Math.max(8,r.left));let top=r.bottom+gap;if(top+h>window.innerHeight-8)top=Math.max(8,r.top-h-gap);card.style.left=left+'px';card.style.top=top+'px'}
function cancelClose(){if(closeTimer!==null){clearTimeout(closeTimer);closeTimer=null}}
function hideCard(){cancelClose();card.style.display='none';card.className='';card.style.maxWidth='';card.style.width='';card.style.removeProperty('--stats-pane-min');delete card.dataset.desiredWidth}
function hideLater(){cancelClose();closeTimer=setTimeout(()=>{if(!card.matches(':hover'))hideCard()},160)}
function showCard(target){cancelClose();const template=document.getElementById(target.dataset.template);if(!template)return;card.innerHTML=template.innerHTML;card.className=target.dataset.cardKind||'';card.dataset.desiredWidth=template.dataset.cardWidth||'1260';card.style.setProperty('--stats-pane-min',(template.dataset.statsMin||'430')+'px');card.style.display='block';requestAnimationFrame(()=>{fitIntegratedCardToContent();requestAnimationFrame(()=>placeCard(target))})}
document.querySelectorAll('.hover').forEach(target=>{
 target.addEventListener('mouseenter',()=>showCard(target));
 target.addEventListener('focus',()=>showCard(target));
 target.addEventListener('mouseleave',hideLater);
 target.addEventListener('blur',hideLater);
});
card.addEventListener('mouseenter',cancelClose); card.addEventListener('mouseleave',hideLater);
card.addEventListener('click',event=>{const tab=event.target.closest('.stats-tab');if(!tab)return;event.preventDefault();const shell=tab.closest('.stats-tabs-shell');if(!shell)return;const key=tab.dataset.statsTab;shell.querySelectorAll('.stats-tab').forEach(item=>{const active=item===tab;item.classList.toggle('active',active);item.setAttribute('aria-selected',active?'true':'false')});shell.querySelectorAll('.stats-tab-panel').forEach(panel=>panel.classList.toggle('active',panel.dataset.statsPanel===key));requestAnimationFrame(()=>fitIntegratedCardToContent())});
async function copyText(value){try{await navigator.clipboard.writeText(value);return true}catch(error){const area=document.createElement('textarea');area.value=value;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();let copied=false;try{copied=document.execCommand('copy')}catch(fallbackError){copied=false}area.remove();return copied}}
function copyValue(button){if(button.dataset.copyKind==='match')return (button.dataset.copyDate||'')+'\t'+(button.dataset.copyHome||'')+'  vs  '+(button.dataset.copyAway||'');return button.dataset.copy||''}
document.addEventListener('click',async event=>{const button=event.target.closest('.copy-url,.copy-match');if(!button)return;event.preventDefault();event.stopPropagation();const copied=await copyText(copyValue(button));button.classList.toggle('copied',copied);if(button.classList.contains('copy-match')){const original=button.dataset.originalHtml||button.innerHTML;button.dataset.originalHtml=original;button.innerHTML='<span class="copy-result">'+(copied?'✓':'!')+'</span>';setTimeout(()=>{button.innerHTML=original;button.classList.remove('copied')},1400);return}const status=button.parentElement.querySelector('.copy-status');if(status){status.textContent=copied?'已複製':'複製失敗';setTimeout(()=>{status.textContent='';button.classList.remove('copied')},1600)}});
const drawer=document.getElementById('chat-drawer');
const chatToggle=document.getElementById('chat-toggle');
const chatLog=document.getElementById('chat-log');
const chatInput=document.getElementById('chat-input');
const chatSend=document.getElementById('chat-send');
const chatWelcome=document.getElementById('chat-welcome');
const settingsDialog=document.getElementById('gemini-settings-dialog');
const CHAT_SETTINGS_KEY='tennisratio.gemini.settings.v1';
const DEFAULT_TENNIS_PROMPT='你是 TennisRatio 網球賽事分析助理。使用繁體中文，回答清楚、精確、可覆盤。以系統提供的 Pinnacle 與 ratio_analysis.json 為主要依據，不捏造賠率、勝率、評級、D值或五項比較。外網只用於查證傷病、退賽、近期賽程、旅行疲勞與官方消息；使用外網時列出資料來源。區分「較可能獲勝」與「目前賠率是否值得下注」，不要承諾獲利。';
let chatHistory=[];
let generating=false;
function loadGeminiSettings(){try{return Object.assign({apiKey:'',baseUrl:'https://generativelanguage.googleapis.com/v1beta',model:'gemini-2.5-flash',systemPrompt:DEFAULT_TENNIS_PROMPT},JSON.parse(localStorage.getItem(CHAT_SETTINGS_KEY)||'{}'))}catch(error){return {apiKey:'',baseUrl:'https://generativelanguage.googleapis.com/v1beta',model:'gemini-2.5-flash',systemPrompt:DEFAULT_TENNIS_PROMPT}}}
let geminiSettings=loadGeminiSettings();
function persistGeminiSettings(){localStorage.setItem(CHAT_SETTINGS_KEY,JSON.stringify(geminiSettings));document.getElementById('chat-model-label').textContent=geminiSettings.model||'gemini-2.5-flash'}
function setDrawer(open){if(document.body.dataset.analysisReady!=='1')return;drawer.classList.toggle('open',open);drawer.setAttribute('aria-hidden',open?'false':'true');chatToggle.classList.toggle('active',open);chatToggle.setAttribute('aria-expanded',open?'true':'false');hideCard();if(open){setTimeout(()=>chatInput.focus(),230);if(!geminiSettings.apiKey)setTimeout(openGeminiSettings,260)}}
chatToggle.setAttribute('aria-expanded','false');
chatToggle.addEventListener('click',()=>setDrawer(!drawer.classList.contains('open')));
document.getElementById('chat-close').addEventListener('click',()=>setDrawer(false));
document.getElementById('chat-new').addEventListener('click',()=>{chatHistory=[];chatLog.innerHTML='';chatWelcome.hidden=false;chatLog.appendChild(chatWelcome);chatInput.value='';chatInput.focus()});
function openGeminiSettings(){document.getElementById('gemini-api-key').value=geminiSettings.apiKey||'';document.getElementById('gemini-base-url').value=geminiSettings.baseUrl||'https://generativelanguage.googleapis.com/v1beta';document.getElementById('gemini-model').value=geminiSettings.model||'gemini-2.5-flash';document.getElementById('gemini-system-prompt').value=geminiSettings.systemPrompt||DEFAULT_TENNIS_PROMPT;document.getElementById('gemini-api-key').type='password';document.getElementById('toggle-api-key').textContent='顯示';settingsDialog.showModal()}
document.getElementById('chat-settings').addEventListener('click',openGeminiSettings);
document.getElementById('settings-close').addEventListener('click',()=>settingsDialog.close());
document.getElementById('settings-cancel').addEventListener('click',()=>settingsDialog.close());
document.getElementById('toggle-api-key').addEventListener('click',()=>{const input=document.getElementById('gemini-api-key');const show=input.type==='password';input.type=show?'text':'password';document.getElementById('toggle-api-key').textContent=show?'隱藏':'顯示'});
document.getElementById('gemini-settings-form').addEventListener('submit',event=>{event.preventDefault();geminiSettings={apiKey:document.getElementById('gemini-api-key').value.trim(),baseUrl:document.getElementById('gemini-base-url').value.trim().replace(/\/+$/,'')||'https://generativelanguage.googleapis.com/v1beta',model:document.getElementById('gemini-model').value.trim()||'gemini-2.5-flash',systemPrompt:document.getElementById('gemini-system-prompt').value.trim()||DEFAULT_TENNIS_PROMPT};persistGeminiSettings();document.getElementById('settings-status').textContent='設定已儲存';setTimeout(()=>settingsDialog.close(),250)});
function createChatMessage(role,text=''){if(chatWelcome)chatWelcome.hidden=true;const message=document.createElement('div');message.className='chat-message '+role;const body=document.createElement('span');body.className='chat-message-body';body.textContent=text;message.appendChild(body);chatLog.appendChild(message);chatLog.scrollTop=chatLog.scrollHeight;return {message,body}}
function addSources(message,sources,queries=[]){if(Array.isArray(queries)&&queries.length){const meta=document.createElement('div');meta.className='chat-meta';meta.textContent='Google Search：'+queries.join('、');message.appendChild(meta)}if(Array.isArray(sources)&&sources.length){const title=document.createElement('div');title.className='chat-sources-title';title.textContent='資料來源';message.appendChild(title);const list=document.createElement('ul');list.className='chat-sources';sources.forEach(source=>{const li=document.createElement('li'),link=document.createElement('a');link.href=String(source.uri||'');link.target='_blank';link.rel='noopener noreferrer';link.textContent=String(source.title||source.uri||'外網來源');li.appendChild(link);list.appendChild(li)});message.appendChild(list)}}
function addContextMeta(message,result){const meta=document.createElement('div');meta.className='chat-meta';const mode=result.context_mode==='selected_matches'?'指定場次完整資料':'全部場次精簡總覽';meta.textContent=`本次上下文：${mode}｜傳送 ${result.sent_match_count||0}/${result.total_match_count||0} 場`;message.appendChild(meta)}
async function typeAnswer(target,text){target.body.textContent='';const cursor=document.createElement('i');cursor.className='typing-cursor';target.message.appendChild(cursor);for(let index=0;index<text.length;index+=3){target.body.textContent+=text.slice(index,index+3);chatLog.scrollTop=chatLog.scrollHeight;await new Promise(resolve=>setTimeout(resolve,10))}cursor.remove()}
function appendError(text){createChatMessage('error',text)}
chatSend.addEventListener('click',async()=>{
 if(generating)return;
 const question=chatInput.value.trim();
 if(!question)return;
 chatHistory.push({role:'user',text:question});
 createChatMessage('user',question);
 chatInput.value='';
 appendError('Gemini介面與設定已完整保留；第一階段尚未接入瀏覽器端 Gemini API。');
 chatInput.focus();
});
chatInput.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();chatSend.click()}});
persistGeminiSettings();
window.addEventListener('resize',hideCard); window.addEventListener('keydown',event=>{if(event.key==='Escape')hideCard()});



const PHASE1_DATA_BASE_URL='.';
async function phase1VerifyStaticData(){
 try{
  const stamp=Date.now();
  const [analysisResponse,todayResponse]=await Promise.all([
   fetch(`${PHASE1_DATA_BASE_URL}/ratio_analysis.json?v=${stamp}`,{cache:'no-store'}),
   fetch(`${PHASE1_DATA_BASE_URL}/today_matches.json?v=${stamp}`,{cache:'no-store'})
  ]);
  if(!analysisResponse.ok)throw new Error(`ratio_analysis.json HTTP ${analysisResponse.status}`);
  if(!todayResponse.ok)throw new Error(`today_matches.json HTTP ${todayResponse.status}`);
  const [analysis,today]=await Promise.all([analysisResponse.json(),todayResponse.json()]);
  const analysisCount=Array.isArray(analysis.matches)?analysis.matches.length:0;
  const payloadCount=Array.isArray(today.matches)?today.matches.length:0;
  const renderedCount=tbody?tbody.rows.length:0;
  if(analysisCount!==renderedCount){
   statusLine.classList.add('error');
   statusText.textContent=`資料驗證警告：ratio_analysis.json ${analysisCount}場，但目前視覺快照為 ${renderedCount}場。`;
   return;
  }
  statusLine.classList.remove('running','error');
  statusText.textContent=`GitHub Pages JS 已載入 ratio_analysis.json｜分析 ${analysisCount}場｜Pinnacle清單 ${payloadCount}場｜第一階段視覺基線完成`;
 }catch(error){
  statusLine.classList.add('error');
  statusText.textContent='靜態JSON載入失敗：'+error.message;
 }
}
phase1VerifyStaticData();
