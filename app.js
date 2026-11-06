/** MailCraft AI frontend. Falls back to an explicitly labelled local template mode if no API is configured. */
'use strict';

const $ = (id) => document.getElementById(id);
const refs = {
  form:$('campaign-form'), brand:$('brand'), offer:$('offer'), industry:$('industry'), audience:$('audience'),
  generate:$('generate-btn'), generateText:$('generate-text'), variants:$('variants-grid'),
  editSubject:$('edit-subject'), editBody:$('edit-body'), editCta:$('edit-cta'), editUrl:$('edit-url'),
  rewrite:$('rewrite-btn'), rewriteText:$('rewrite-text'), toast:$('toast'),
  imageInput:$('image-input'), imageList:$('image-list'),
  htmlEditor:$('html-editor'), htmlState:$('html-state'), previewHtml:$('preview-html'),
};
const labels = {
  goals:{promotion:'Khuyến mãi',launch:'Ra mắt sản phẩm',retention:'Chăm sóc khách hàng'},
  industries:{food:'Ẩm thực & đồ uống',retail:'Bán lẻ & TMĐT',fashion:'Thời trang & làm đẹp',education:'Giáo dục & đào tạo',tech:'Công nghệ & phần mềm',service:'Dịch vụ khác'}
};
const variants = [
  {name:'Tập trung lợi ích',icon:'ri-gift-line',note:'Nêu rõ giá trị người nhận nhận được'},
  {name:'Kể chuyện gần gũi',icon:'ri-chat-heart-line',note:'Tạo kết nối và sự quan tâm'},
  {name:'Ngắn gọn, trực tiếp',icon:'ri-flashlight-line',note:'Đi thẳng vào thông điệp chính'}
];
const timing = {
  food:{times:[['Thứ Ba','09:00 – 10:30'],['Thứ Năm','14:00 – 15:30']],reason:'Có thể thử khung giờ đầu ngày và đầu giờ chiều, rồi so sánh kết quả thực tế.'},
  retail:{times:[['Thứ Tư','11:00 – 12:00'],['Thứ Sáu','18:00 – 19:30']],reason:'Hãy thử đối chiếu thời gian nghỉ trưa với thời điểm sau giờ làm việc.'},
  fashion:{times:[['Thứ Năm','12:00 – 13:00'],['Chủ Nhật','19:00 – 20:30']],reason:'Có thể kiểm tra mức quan tâm trong giờ nghỉ và buổi tối cuối tuần.'},
  education:{times:[['Thứ Ba','19:00 – 20:30'],['Thứ Bảy','09:00 – 10:30']],reason:'Thử một khung giờ buổi tối ngày thường và sáng cuối tuần theo nhóm người học.'},
  tech:{times:[['Thứ Ba','09:00 – 10:00'],['Thứ Năm','10:00 – 11:00']],reason:'Có thể thử khung giờ làm việc buổi sáng cho tệp khách hàng doanh nghiệp.'},
  service:{times:[['Thứ Tư','10:00 – 11:00'],['Thứ Sáu','14:00 – 15:00']],reason:'Hai khung giờ khởi đầu để thử nghiệm trước khi có dữ liệu tương tác thực tế.'}
};
let engine = 'demo';
let stage = 1;
let latestUnlocked = 1;
let campaign = null;
let emails = [];
let currentEmail = 0;
let schedule = null;
let toastTimer = null;
let busy = false;
let previewMode = 'text';

const IMAGE_RULES = { maxCount: 4, maxBytes: 2 * 1024 * 1024, types: ['image/png','image/jpeg','image/webp','image/gif'] };
const MAILTO_BUDGET = 1900;

function clean(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
function initials(v) { return clean(v).split(' ').filter(Boolean).slice(0,2).map(x=>x[0]).join('').toLocaleUpperCase('vi-VN') || 'MC'; }
function text(id,value) { $(id).textContent = value; }
function toast(message,isError=false) {
  window.clearTimeout(toastTimer);
  refs.toast.textContent=message;
  refs.toast.classList.toggle('error',isError);
  refs.toast.classList.add('visible');
  toastTimer=window.setTimeout(()=>refs.toast.classList.remove('visible'),3400);
}
function readCampaign() {
  return {
    brand:clean(refs.brand.value),goal:document.querySelector('input[name="goal"]:checked')?.value || 'promotion',
    offer:clean(refs.offer.value),industry:refs.industry.value,audience:clean(refs.audience.value)
  };
}
function updateBrief() {
  const d=readCampaign();
  text('brief-brand',d.brand || 'Chưa nhập');
  text('brief-goal',labels.goals[d.goal]);
  text('brief-industry',labels.industries[d.industry]);
  text('brief-audience',d.audience || 'Khách hàng chung');
  text('offer-count',`${refs.offer.value.length}/420`);
}
function validateCampaign() {
  ['brand','offer'].forEach(k=>{refs[k].removeAttribute('aria-invalid');text(k+'-error','');});
  const first=[];
  const d=readCampaign();
  if(!d.brand){text('brand-error','Vui lòng nhập tên thương hiệu.');refs.brand.setAttribute('aria-invalid','true');first.push(refs.brand);}
  if(!d.offer){text('offer-error','Vui lòng nhập thông điệp chính.');refs.offer.setAttribute('aria-invalid','true');first.push(refs.offer);}
  if(first.length){first[0].focus();toast('Vui lòng bổ sung những thông tin bắt buộc.',true);return null;}
  return d;
}
function setBusy(isBusy,type='generate') {
  busy=isBusy;
  refs.generate.disabled=isBusy;
  refs.rewrite.disabled=isBusy;
  $('regenerate-btn').disabled=isBusy;
  refs.generateText.textContent=isBusy&&type==='generate'?'Đang tạo nội dung...':'Tạo 3 mẫu email';
  refs.rewriteText.textContent=isBusy&&type==='rewrite'?'Đang viết lại...':'Viết lại mẫu này';
}
function setStep(next) {
  if(next<1 || next>latestUnlocked || busy)return;
  if(next===3 && !validateEditor())return;
  stage=next;
  [1,2,3].forEach(num=>{
    $('stage-'+num).hidden=num!==next;
    const button=$('step-nav-'+num);
    const cur=num===next;
    button.disabled=num>latestUnlocked;
    button.classList.toggle('is-current',cur);
    button.classList.toggle('is-complete',num<next);
    if(cur) button.setAttribute('aria-current','step'); else button.removeAttribute('aria-current');
    const icon=$('step-icon-'+num);
    if(num<next){icon.replaceChildren(makeIcon('ri-check-line'));}else{icon.textContent=String(num).padStart(2,'0');}
  });
  document.querySelectorAll('.step-connector').forEach((node,i)=>node.classList.toggle('is-complete',i+1<next));
  if(next===3)renderPreview();
  if(window.scrollY>125)window.scrollTo({top:0,behavior:'smooth'});
}
function shorter(v,n){const s=clean(v).replace(/[.!?。]+$/,'');return s.length>n?s.slice(0,n-1).trim()+'…':s;}
function makeDemo(d) {
  const audience=d.audience||'bạn';
  const greeting=`Xin chào ${audience},`;
  const intro={
    promotion:{benefit:'Một ưu đãi dành cho bạn',story:'Những điều nhỏ bé đôi khi mang đến niềm vui bất ngờ.',direct:'Ưu đãi mới đã sẵn sàng.',ctas:['Xem ưu đãi','Khám phá thêm','Xem ngay']},
    launch:{benefit:'Khám phá sản phẩm mới',story:'Mỗi sản phẩm mới đều bắt đầu từ một ý tưởng đáng chia sẻ.',direct:'Sản phẩm mới vừa được giới thiệu.',ctas:['Tìm hiểu sản phẩm','Khám phá câu chuyện','Xem sản phẩm']},
    retention:{benefit:'Cảm ơn bạn đã đồng hành',story:'Những mối quan hệ bền lâu được xây dựng từ sự quan tâm chân thành.',direct:'Một lời nhắn dành riêng cho bạn.',ctas:['Xem lời nhắn','Khám phá thêm','Tìm hiểu ngay']}
  }[d.goal];
  const mails=[
    {subject:d.goal==='launch'?`Khám phá điều mới từ ${d.brand}`:d.goal==='retention'?`${d.brand} gửi lời cảm ơn đến bạn`:`Ưu đãi mới từ ${d.brand} dành cho bạn`,body:`${greeting}\n\n${intro.benefit}.\n\n${d.brand} muốn chia sẻ với bạn thông tin sau: ${d.offer}\n\nHy vọng thông tin này sẽ giúp bạn có thêm lựa chọn phù hợp.\n\nTrân trọng,\nĐội ngũ ${d.brand}`,cta:intro.ctas[0],url:''},
    {subject:d.goal==='promotion'?`Một tin vui nhỏ từ ${d.brand} ✨`:`Câu chuyện mới tại ${d.brand}`,body:`${greeting}\n\n${intro.story}\n\nHôm nay, ${d.brand} muốn gửi đến bạn một thông tin đáng chú ý:\n\n${d.offer}\n\nNếu bạn đang quan tâm, hãy dành một chút thời gian khám phá nhé.\n\nThân mến,\n${d.brand}`,cta:intro.ctas[1],url:''},
    {subject:d.goal==='launch'?`Đã có mặt: Sản phẩm mới từ ${d.brand}`:`${shorter(d.offer,72)} | ${d.brand}`,body:`${greeting}\n\n${intro.direct}\n\n${d.offer}\n\nXem thông tin chi tiết để lựa chọn bước tiếp theo phù hợp với bạn.\n\n${d.brand}`,cta:intro.ctas[2],url:''}
  ];
  return {emails:mails,schedule:{primary:{day:timing[d.industry].times[0][0],time:timing[d.industry].times[0][1]},secondary:{day:timing[d.industry].times[1][0],time:timing[d.industry].times[1][1]},reason:timing[d.industry].reason}};
}
function rewriteDemo(original,tone,d) {
  const salutation=d.audience||'Quý khách';
  const toneTemplates={
    formal:{subject:`${d.brand} | Thông tin dành cho Quý khách`,body:`Kính gửi ${salutation},\n\n${d.brand} trân trọng gửi đến Quý khách thông tin sau: ${d.offer}\n\nChúng tôi hy vọng thông tin này sẽ hữu ích và mong tiếp tục nhận được sự quan tâm của Quý khách.\n\nTrân trọng,\nĐội ngũ ${d.brand}`,cta:original.cta},
    fun:{subject:`Có tin thú vị từ ${d.brand} đây! ✨`,body:`Chào ${salutation}!\n\nMột tin nhỏ có thể khiến ngày hôm nay vui hơn một chút đây!\n\n${d.offer}\n\nNghe hấp dẫn phải không? Ghé xem khi bạn có thời gian nhé.\n\nHẹn gặp bạn,\n${d.brand}`,cta:'Khám phá ngay'},
    urgent:{subject:`Đừng bỏ lỡ thông tin này từ ${d.brand}`,body:`Xin chào ${salutation},\n\n${d.brand} có thông tin đáng chú ý dành cho bạn:\n\n${d.offer}\n\nHãy xem chi tiết ngay để chủ động quyết định liệu nội dung này có phù hợp với nhu cầu của bạn.\n\nTrân trọng,\n${d.brand}`,cta:'Xem thông tin ngay'}
  };
  // The urgency style never invents an expiry date, scarcity or purchase deadline.
  return {...toneTemplates[tone],url:original.url||''};
}
async function queryAI(action,data) {
  const controller=new AbortController();
  const timer=window.setTimeout(()=>controller.abort(),25000);
  try{
    const response=await fetch('/api/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:controller.signal,cache:'no-store'});
    let result;
    try{result=await response.json();}catch(cause){throw new Error('Máy chủ trả về dữ liệu không hợp lệ.',{cause});}
    if(!response.ok)throw new Error(result.error||'Không thể kết nối AI. Hãy thử lại sau.');
    return result;
  }catch(error){if(error?.name==='AbortError')throw new Error('Yêu cầu quá thời gian. Vui lòng thử lại.',{cause:error});throw error;}
  finally{window.clearTimeout(timer);}
}
function normalizeEmails(data){
  if(!data||!Array.isArray(data.emails)||data.emails.length!==3)throw new Error('AI chưa trả về đủ 3 mẫu email.');
  return data.emails.map(mail=>{
    if(!mail||typeof mail.subject!=='string'||typeof mail.body!=='string'||typeof mail.cta!=='string'||!clean(mail.subject)||!clean(mail.body)||!clean(mail.cta))throw new Error('Một mẫu email thiếu nội dung cần thiết.');
    return {subject:mail.subject.slice(0,140),body:mail.body.slice(0,2400),cta:mail.cta.slice(0,70),url:''};
  });
}
function normalizeSchedule(obj,industry){
  const fallback=makeDemo({...campaign,industry,goal:'promotion',brand:'',offer:'',audience:''}).schedule;
  const validSlot=v=>v&&typeof v.day==='string'&&typeof v.time==='string'&&clean(v.day)&&clean(v.time);
  return {primary:validSlot(obj?.primary)?{day:obj.primary.day.slice(0,35),time:obj.primary.time.slice(0,45)}:fallback.primary,
    secondary:validSlot(obj?.secondary)?{day:obj.secondary.day.slice(0,35),time:obj.secondary.time.slice(0,45)}:fallback.secondary,
    reason:typeof obj?.reason==='string'&&clean(obj.reason)?obj.reason.slice(0,480):fallback.reason};
}
async function generateEmails() {
  const d=validateCampaign();if(!d||busy)return;
  setBusy(true,'generate');
  try{
    const data=engine==='ai'?await queryAI('generate',d):makeDemo(d);
    const mails=normalizeEmails(data);
    campaign=d;emails=mails;schedule=normalizeSchedule(data.schedule,d.industry);currentEmail=0;
    latestUnlocked=3;
    text('campaign-summary-brand',d.brand);text('campaign-summary-goal',labels.goals[d.goal]);text('campaign-summary-industry',labels.industries[d.industry]);
    $('generation-source').classList.toggle('is-demo',engine!=='ai');
    $('generation-source').innerHTML=engine==='ai'?'<i class="ri-sparkling-2-line" aria-hidden="true"></i> Nội dung do AI tạo':'<i class="ri-draft-line" aria-hidden="true"></i> Nội dung mẫu để trải nghiệm';
    renderVariants();selectVariant(0);renderSchedule();
    setBusy(false);setStep(2);toast('Đã tạo 3 mẫu email.');
  }catch(err){toast(err.message||'Không thể tạo email. Vui lòng thử lại.',true);setBusy(false);}
}
function makeIcon(iconClass){const node=document.createElement('i');node.className=iconClass;node.setAttribute('aria-hidden','true');return node;}
function renderVariants() {
  refs.variants.replaceChildren();
  emails.forEach((mail,index)=>{
    const card=document.createElement('button');card.type='button';card.className='variant-card'+(index===currentEmail?' is-selected':'');card.setAttribute('role','tab');card.setAttribute('aria-selected',String(index===currentEmail));card.setAttribute('aria-label',`Chọn mẫu ${index+1}, ${variants[index].name}`);
    const top=document.createElement('div');top.className='variant-top';
    const symbol=document.createElement('span');symbol.className='variant-symbol';symbol.append(makeIcon(variants[index].icon));
    const checked=document.createElement('span');checked.className='variant-pick';if(index===currentEmail)checked.append(makeIcon('ri-check-line'));
    top.append(symbol,checked);
    const name=document.createElement('span');name.className='variant-name';name.textContent=`MẪU 0${index+1}  ·  ${variants[index].name}`;
    const title=document.createElement('strong');title.textContent=mail.subject;
    const desc=document.createElement('p');desc.textContent=shorter(mail.body,115);
    card.append(top,name,title,desc);
    card.addEventListener('click',()=>selectVariant(index));
    const wrap=document.createElement('div');wrap.className='variant-wrap';wrap.setAttribute('role','presentation');
    const quickCopy=document.createElement('button');quickCopy.type='button';quickCopy.className='variant-quickcopy';quickCopy.setAttribute('aria-label',`Sao chép mẫu email ${index+1}`);quickCopy.append(makeIcon('ri-file-copy-line'),document.createTextNode(' Sao chép'));
    quickCopy.addEventListener('click',(e)=>{e.stopPropagation();selectVariant(index);copyEmail();});
    wrap.append(card,quickCopy);refs.variants.append(wrap);
  });
}
function selectVariant(index) {
  if(index<0||index>=emails.length)return;
  currentEmail=index;
  refs.editSubject.value=emails[index].subject;
  refs.editBody.value=emails[index].body;
  refs.editCta.value=emails[index].cta;
  refs.editUrl.value=emails[index].url||'';
  text('selected-tag',`MẪU 0${index+1} · ${variants[index].name.toUpperCase()}`);
  text('finish-selected',`Mẫu 0${index+1} · ${variants[index].name}`);
  updateEditorCounts();
  ensureImages(emails[index]);
  renderImages();
  syncHtmlEditor();
  refs.editSubject.removeAttribute('aria-invalid');refs.editBody.removeAttribute('aria-invalid');refs.editCta.removeAttribute('aria-invalid');refs.editUrl.removeAttribute('aria-invalid');text('edit-error','');
  renderVariants();renderPreview();
}
function updateEditorCounts(){text('subject-count',`${refs.editSubject.value.length}/140`);text('body-count',`${refs.editBody.value.length}/2400`);}
function editEmail(){
  const m=emails[currentEmail];if(!m)return;
  m.subject=refs.editSubject.value;
  m.body=refs.editBody.value;
  m.cta=refs.editCta.value;
  m.url=refs.editUrl.value.trim();
  markHtmlStale(m);
  updateEditorCounts();renderVariants();renderPreview();
}
function validateEditor() {
  const m=emails[currentEmail];if(!m)return false;
  text('edit-error','');[refs.editSubject,refs.editBody,refs.editCta,refs.editUrl].forEach(e=>e.removeAttribute('aria-invalid'));
  const fields=[[refs.editSubject,'tiêu đề'],[refs.editBody,'nội dung'],[refs.editCta,'CTA']];
  for(const [element,name] of fields){if(!clean(element.value)){element.setAttribute('aria-invalid','true');text('edit-error',`Vui lòng nhập ${name} email trước khi tiếp tục.`);setStepWithoutValidation(2);element.focus();return false;}}
  if(m.url){try{const u=new URL(m.url);if(!['http:','https:'].includes(u.protocol))throw Error('scheme');}catch{refs.editUrl.setAttribute('aria-invalid','true');text('edit-error','Đường dẫn CTA phải bắt đầu bằng http:// hoặc https://.');setStepWithoutValidation(2);refs.editUrl.focus();return false;}}
  return true;
}
function setStepWithoutValidation(n){if(stage!==n)setStep(n);} // Return to editing controls after invalid input.

/* ---- Ảnh đính kèm theo từng mẫu ---- */
function ensureImages(m){if(m&&!Array.isArray(m.images))m.images=[];}
function renderImages(){
  const m=emails[currentEmail],list=m&&Array.isArray(m.images)?m.images:[];
  refs.imageList.replaceChildren();
  list.forEach((img,i)=>{
    const chip=document.createElement('span');chip.className='image-chip';
    const thumb=document.createElement('img');thumb.src=img.src;thumb.alt=img.name;
    const name=document.createElement('small');name.textContent=img.name;
    if(img.hosted){
      const badge=document.createElement('i');
      badge.className='ri-cloud-line image-hosted';
      badge.title='Lưu trên kho ảnh, gắn vào email bằng URL';
      badge.setAttribute('aria-hidden','true');
      name.append(badge);
    }
    const del=document.createElement('button');del.type='button';del.className='image-remove';del.dataset.index=String(i);
    del.setAttribute('aria-label',`Xoá ảnh ${img.name}`);del.append(makeIcon('ri-close-line'));
    chip.append(thumb,name,del);refs.imageList.append(chip);
  });
}
/* Ưu tiên đưa ảnh lên kho R2 (/api/upload) để email dùng URL — nếu chưa cấu
   hình (501) hoặc lỗi mạng thì tự rơi về ảnh nhúng base64; không bao giờ chết. */
function readAsDataURL(file){
  return new Promise(resolve=>{
    const reader=new FileReader();
    reader.onload=()=>resolve({name:file.name,src:String(reader.result)});
    reader.onerror=()=>resolve(null);
    reader.readAsDataURL(file);
  });
}
async function uploadImage(file){
  try{
    const response=await fetch('/api/upload',{method:'POST',headers:{'Content-Type':file.type},body:file,signal:AbortSignal.timeout(15000)});
    if(!response.ok)return null;
    const data=await response.json().catch(()=>null);
    if(!data||typeof data.url!=='string'||!data.url.startsWith('/'))return null;
    return data.url;
  }catch{return null;}
}
async function addImages(filesList){
  const m=emails[currentEmail];if(!m)return;
  ensureImages(m);
  const skipped=[];let limitReached=false,hostedCount=0;
  const jobs=[];
  for(const file of [...filesList]){
    if(m.images.length+jobs.length>=IMAGE_RULES.maxCount){limitReached=true;break;}
    if(!IMAGE_RULES.types.includes(file.type)||file.size>IMAGE_RULES.maxBytes){skipped.push(file.name);continue;}
    jobs.push((async()=>{
      const url=await uploadImage(file);
      if(url){hostedCount++;return {name:file.name,src:url,hosted:true};}
      return readAsDataURL(file);
    })());
  }
  const list=await Promise.all(jobs);
  list.forEach(item=>{if(item)m.images.push(item);});
  const added=list.filter(Boolean).length;
  // Gom mọi cảnh báo vào MỘT toast: trước đây cảnh báo "tối đa 4 ảnh" bị toast
  // thành công ghi đè ngay sau đó nên người dùng không bao giờ đọc được.
  const problems=[];
  if(limitReached)problems.push(`Tối đa ${IMAGE_RULES.maxCount} ảnh mỗi email`);
  if(skipped.length)problems.push(`${skipped.length} ảnh bị bỏ qua (định dạng không hỗ trợ hoặc vượt quá 2 MB)`);
  if(problems.length)toast(problems.join('. ')+'.',true);
  else if(added){
    if(hostedCount===added)toast('Đã thêm ảnh (lưu trên kho ảnh, gắn vào email bằng URL).');
    else toast('Đã thêm ảnh. Ảnh sẽ xuất hiện trong file HTML tải về.');
  }
  if(m.html)markHtmlStale(m);
  renderImages();
}
function removeImage(index){
  const m=emails[currentEmail];if(!m||!m.images||!m.images[index])return;
  m.images.splice(index,1);renderImages();markHtmlStale(m);toast('Đã xoá ảnh.');
}

/* ---- HTML email: sinh chuẩn, cho sửa tuỳ ý, dùng làm đại diện khi xuất ---- */
function buildEmailHTML(m){
  const brand=escapeHTML(campaign.brand);const subject=escapeHTML(m.subject);
  const body=escapeHTML(m.body).replace(/\n/g,'<br>');
  const cta=escapeHTML(m.cta);
  const action=m.url?`<a href="${escapeHTML(m.url)}" style="display:inline-block;background:#574be8;color:#fff;text-decoration:none;border-radius:8px;padding:13px 20px;font-size:14px;font-weight:700">${cta}</a>`:`<span style="display:inline-block;background:#574be8;color:#fff;border-radius:8px;padding:13px 20px;font-size:14px;font-weight:700">${cta}</span>`;
  const images=(Array.isArray(m.images)?m.images:[]).map(img=>{
    // URL tương đối (/media/…) đổi thành tuyệt đối để file HTML tải về ngoài web vẫn hiện ảnh
    const src=img.src.startsWith('data:')||/^https?:\/\//i.test(img.src)?img.src:location.origin+img.src;
    return `<img src="${escapeHTML(src)}" alt="${escapeHTML(img.name)}" style="display:block;width:100%;max-width:100%;height:auto;border:1px solid #e6e9f3;border-radius:10px;margin:0 0 16px">`;
  }).join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${subject}</title></head><body style="margin:0;padding:28px 12px;background:#f4f5f9;font-family:Arial,Helvetica,sans-serif;color:#202a44"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:620px;margin:0 auto;background:#fff;border-collapse:collapse"><tr><td style="padding:40px 34px"><p style="font-size:13px;font-weight:bold;color:#574be8;margin:0 0 18px">${brand}</p><h1 style="font-size:25px;line-height:1.45;margin:0 0 23px;color:#202a44">${subject}</h1><div style="font-size:14px;line-height:1.9;color:#4a5670">${body}</div>${images}<p style="margin:28px 0 0">${action}</p><p style="margin:42px 0 0;padding-top:16px;border-top:1px solid #edf0f6;color:#8b95a7;font-size:12px">${brand}</p></td></tr></table></body></html>`;
}
function markHtmlStale(m){if(m&&m.html&&!m.htmlStale){m.htmlStale=true;updateHtmlState(m);}}
function updateHtmlState(m){
  const on=!!(m&&m.html);
  refs.htmlState.hidden=!on;
  refs.htmlState.textContent=on&&m.htmlStale?'HTML tuỳ chỉnh (chưa khớp nội dung mới)':'HTML tuỳ chỉnh đang dùng';
  refs.htmlState.classList.toggle('is-stale',!!(on&&m.htmlStale));
  $('clear-html-btn').hidden=!on;
}
function syncHtmlEditor(){
  const m=emails[currentEmail];
  if(!m){refs.htmlEditor.value='';updateHtmlState(null);return;}
  ensureImages(m);
  refs.htmlEditor.value=m.html||'';
  updateHtmlState(m);
}
function buildEmailFromFields(){
  const m=emails[currentEmail];if(!m)return;
  m.html=buildEmailHTML(m);m.htmlStale=false;
  refs.htmlEditor.value=m.html;updateHtmlState(m);
  toast('Đã sinh HTML chuẩn từ nội dung hiện tại.');
}
function clearHtmlOverride(){
  const m=emails[currentEmail];if(!m)return;
  m.html=null;m.htmlStale=false;
  refs.htmlEditor.value='';updateHtmlState(m);
  toast('Đã đặt lại về nội dung gốc. HTML sẽ sinh khi cần.');
}

/* ---- Xem trước ở ba chế độ: text / HTML (iframe sandbox) ---- */
function setPreviewMode(mode){
  if(mode!=='text'&&mode!=='html')return;
  previewMode=mode;
  document.querySelectorAll('.content-switch .view-btn').forEach(btn=>{
    const active=btn.dataset.content===mode;
    btn.classList.toggle('active',active);
    btn.setAttribute('aria-pressed',String(active));
  });
  $('email-frame').hidden=mode==='html';
  refs.previewHtml.hidden=mode!=='html';
  if(mode==='html')renderPreviewHtml();
}
function renderPreviewHtml(){
  if(!emails.length)return;
  const m=emails[currentEmail]||emails[0];
  refs.previewHtml.srcdoc=(m&&m.html)||buildEmailHTML(m);
}

/* ---- Xuất mailto: chỉ mang text + link, tự rút gọn theo budget URL ~2000 ký tự ---- */
function buildMailtoUrl(m){
  const note='\n\n[MailCraft: nội dung đã rút gọn cho vừa trình gửi thư — bản đầy đủ nằm trong file HTML]';
  let body=formatEmailText(m);
  let url=`mailto:?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(body)}`;
  if(url.length>MAILTO_BUDGET){
    for(let i=1;i<=19&&url.length>MAILTO_BUDGET;i++){
      body=body.slice(0,Math.max(200,2400-i*120));
      body=body.replace(/\s+\S*$/,'');
      url=`mailto:?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(body+note)}`;
    }
    if(url.length>MAILTO_BUDGET)url=`mailto:?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(body)}`;
  }
  return {url,cut:url.length>MAILTO_BUDGET};
}
function mailtoExport(){
  if(!validateEditor())return;
  const m=emails[currentEmail];if(!m)return;
  const {url,cut}=buildMailtoUrl(m);
  window.location.href=url;
  if(cut)toast('Nội dung dài nên đã rút gọn khi đưa vào mailto. Bản đầy đủ: nút Tải email HTML.',true);
  else if(m.images&&m.images.length)toast('Đã soạn thư trong trình gửi mail. Ảnh cần đính kèm qua file HTML.');
  else toast('Đã soạn thảo trong trình gửi thư của bạn.');
}
async function rewriteEmail(){
  if(busy||!campaign||!validateEditor())return;
  const tone=document.querySelector('input[name="tone"]:checked')?.value||'formal';
  const previous={...emails[currentEmail]};
  setBusy(true,'rewrite');
  try{
    const result=engine==='ai'?await queryAI('rewrite',{campaign,email:previous,tone}):{email:rewriteDemo(previous,tone,campaign)};
    const e=result.email;
    if(!e||!clean(e.subject)||!clean(e.body)||!clean(e.cta))throw new Error('AI trả về nội dung chưa hợp lệ.');
    emails[currentEmail]={subject:String(e.subject).slice(0,140),body:String(e.body).slice(0,2400),cta:String(e.cta).slice(0,70),url:previous.url};
    selectVariant(currentEmail);toast('Đã viết lại mẫu email theo phong cách đã chọn.');
  }catch(error){toast(error.message||'Không thể viết lại. Vui lòng thử lại.',true);}
  finally{setBusy(false);}
}
function renderSchedule(){
  if(!campaign||!schedule)return;
  text('timing-category',labels.industries[campaign.industry]);
  text('time-primary',`${schedule.primary.day} · ${schedule.primary.time}`);
  text('time-secondary',`${schedule.secondary.day} · ${schedule.secondary.time}`);
  text('timing-reason',schedule.reason);
}
function renderPreview() {
  if(!campaign||!emails.length)return;
  const m=emails[currentEmail];
  text('sender-name',campaign.brand);text('sender-avatar',initials(campaign.brand));text('preview-brand-footer',campaign.brand);
  text('preview-subject',m.subject||'Chưa có tiêu đề');text('preview-body',m.body||'Chưa có nội dung');
  const cta=$('preview-cta');cta.replaceChildren(document.createTextNode((m.cta||'Xem thêm')+' '),makeIcon('ri-arrow-right-line'));
  if(previewMode==='html')renderPreviewHtml();
}
function formatEmailText(m){return `Tiêu đề: ${m.subject}\n\n${m.body}\n\nCTA: ${m.cta}${m.url?'\nLiên kết: '+m.url:''}`;}
async function copyEmail(){if(!validateEditor())return;const value=formatEmailText(emails[currentEmail]);
  try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(value);}else{const el=document.createElement('textarea');el.value=value;el.style.position='fixed';el.style.top='-9999px';document.body.append(el);el.select();const success=document.execCommand('copy');el.remove();if(!success)throw Error('copy');}toast('Đã sao chép email vào bộ nhớ tạm.');}catch{toast('Trình duyệt không cho sao chép tự động. Hãy thử trên HTTPS.',true);}}
function escapeHTML(s){return String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function downloadHTML(){
  if(!validateEditor())return;
  const m=emails[currentEmail];
  if(m.html){if(m.htmlStale)toast('Đang tải HTML tuỳ chỉnh — lưu ý vẫn có thay đổi mới chưa được đưa vào.',true);else toast('Đang tải file HTML tuỳ chỉnh của email.');downloadBlob(m.html,currentEmail);return;}
  downloadBlob(buildEmailHTML(m),currentEmail);toast('Đã tải xuống mẫu email HTML.');
}
function downloadBlob(html,index){const blob=new Blob([html],{type:'text/html;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`mailcraft-email-${index+1}.html`;document.body.append(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1500);}
function resetAll(){
  if(busy)return;
  if(emails.length&&!window.confirm('Tạo chiến dịch mới? Các mẫu email trong phiên hiện tại sẽ không được giữ lại.'))return;
  emails=[];campaign=null;schedule=null;currentEmail=0;latestUnlocked=1;
  refs.form.reset();refs.brand.value='';refs.offer.value='';refs.audience.value='';
  refs.imageList.replaceChildren();refs.htmlEditor.value='';updateHtmlState(null);setPreviewMode('text');
  updateBrief();setStep(1);toast('Đã tạo chiến dịch mới.');refs.brand.focus();
}
async function detectEngine(){
  try{
    // Status endpoint is available when the Cloudflare Worker is deployed.
    const response=await fetch('/api/status',{cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(6000)});
    if(response.ok){const data=await response.json();if(data.mode==='ai')engine='ai';}
  }catch{engine='demo';}
  const status=$('engine-status');status.classList.toggle('is-ai',engine==='ai');status.classList.toggle('is-demo',engine!=='ai');
  text('engine-label',engine==='ai'?'AI đã cấu hình':'Chế độ trải nghiệm');
}

refs.form.addEventListener('submit',(e)=>{e.preventDefault();generateEmails();});
[refs.brand,refs.offer,refs.industry,refs.audience].forEach(el=>el.addEventListener('input',updateBrief));
document.querySelectorAll('input[name="goal"]').forEach(el=>el.addEventListener('change',updateBrief));
[refs.editSubject,refs.editBody,refs.editCta,refs.editUrl].forEach(el=>el.addEventListener('input',editEmail));
refs.rewrite.addEventListener('click',rewriteEmail);
$('regenerate-btn').addEventListener('click',()=>{setStep(1);generateEmails();});
$('back-to-setup').addEventListener('click',()=>setStep(1));
$('prev-step-2').addEventListener('click',()=>setStep(1));
$('to-preview').addEventListener('click',()=>{if(validateEditor())setStep(3);});
$('back-to-editor').addEventListener('click',()=>setStep(2));
$('change-variant-btn').addEventListener('click',()=>setStep(2));
$('copy-btn').addEventListener('click',copyEmail);
$('download-btn').addEventListener('click',downloadHTML);
$('new-campaign').addEventListener('click',resetAll);
document.querySelectorAll('.step-item').forEach(btn=>btn.addEventListener('click',()=>setStep(Number(btn.dataset.step))));
document.querySelectorAll('.view-btn').forEach(btn=>btn.addEventListener('click',()=>{
  const mobile=btn.dataset.view==='mobile';$('preview-canvas').classList.toggle('is-mobile',mobile);
  document.querySelectorAll('.view-btn').forEach(b=>{const active=b===btn;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
}));
/* Bindings: ảnh, HTML email, kiểu nội dung preview, xuất mailto (v4) */
refs.imageInput.addEventListener('change',()=>{addImages(refs.imageInput.files);refs.imageInput.value='';});
refs.imageList.addEventListener('click',(event)=>{const btn=event.target.closest('.image-remove');if(!btn)return;removeImage(Number(btn.dataset.index));});
$('build-html-btn').addEventListener('click',buildEmailFromFields);
$('clear-html-btn').addEventListener('click',clearHtmlOverride);
refs.htmlEditor.addEventListener('input',()=>{const m=emails[currentEmail];if(!m)return;m.html=refs.htmlEditor.value.trim()||null;m.htmlStale=false;updateHtmlState(m);});
document.querySelectorAll('.content-switch .view-btn').forEach(btn=>btn.addEventListener('click',()=>setPreviewMode(btn.dataset.content)));
$('mailto-btn').addEventListener('click',mailtoExport);
updateBrief();detectEngine();


/* Public pages and navigation */
const pageIds=['home','studio','guide'];
const menuButton=$('mobile-menu-btn');
const siteNav=$('site-nav');
function closeSiteNav(){siteNav.classList.remove('is-open');menuButton.setAttribute('aria-expanded','false');menuButton.setAttribute('aria-label','Mở menu điều hướng');menuButton.querySelector('i').className='ri-menu-3-line';menuButton.querySelector('.mobile-menu-label').textContent='Menu';}
function navigatePage(page){
  if(!pageIds.includes(page)) page='home';
  pageIds.forEach(name=>{$(name+'-page').hidden=name!==page;});
  // Skip-link phải trỏ tới <main> đang hiển thị (mỗi main đều có tabindex="-1"),
  // nếu không thì ở #studio/#guide nó trỏ vào vùng đã bị ẩn.
  const skipLink=document.querySelector('.skip-link');if(skipLink)skipLink.setAttribute('href','#'+page+'-page');
  document.querySelectorAll('.nav-link').forEach(a=>{const active=a.dataset.pageLink===page;a.classList.toggle('is-active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  document.title=page==='home'?'MailCraft AI | Công cụ viết Email Marketing thông minh':page==='studio'?'Tạo email | MailCraft AI':'Hướng dẫn | MailCraft AI';
  closeSiteNav();window.scrollTo({top:0,behavior:'instant'});
}
function readCurrentPage(){
  // Chấp nhận cả `#studio` và `#studio-page` (skip-link dùng id của <main>).
  const name=location.hash.replace(/^#/, '').split(/[?&]/)[0].replace(/-page$/, '');
  return pageIds.includes(name)?name:'home';
}
/* Skip-link: chuyển focus trực tiếp thay vì để hash đi qua router — mọi hash
   đều được hiểu là tên trang, nên trước đây bấm skip-link ở #studio lại bị đẩy
   về trang chủ (và <main> vừa trỏ tới bị ẩn). */
const skipLink=document.querySelector('.skip-link');
if(skipLink)skipLink.addEventListener('click',(event)=>{
  event.preventDefault();
  const target=$(readCurrentPage()+'-page');
  if(!target)return;
  target.focus();target.scrollIntoView({block:'start'});
});
menuButton.addEventListener('click',()=>{const open=!siteNav.classList.contains('is-open');siteNav.classList.toggle('is-open',open);menuButton.setAttribute('aria-expanded',String(open));menuButton.setAttribute('aria-label',open?'Đóng menu điều hướng':'Mở menu điều hướng');menuButton.querySelector('i').className=open?'ri-close-line':'ri-menu-3-line';menuButton.querySelector('.mobile-menu-label').textContent=open?'Đóng':'Menu';});
document.addEventListener('click',(event)=>{if(!siteNav.contains(event.target)&&!menuButton.contains(event.target))closeSiteNav();});
document.addEventListener('keydown',(event)=>{if(event.key==='Escape')closeSiteNav();});
window.addEventListener('hashchange',()=>navigatePage(readCurrentPage()));
navigatePage(readCurrentPage());
const presets={
  promotion:{brand:'Luna Coffee',goal:'promotion',offer:'Giảm 20% cho cà phê hạt rang đến hết Chủ nhật.',industry:'food',audience:'Người yêu cà phê'},
  launch:{brand:'Nova Tech',goal:'launch',offer:'Ra mắt dòng tai nghe không dây mới với thời lượng pin lên đến 24 giờ.',industry:'tech',audience:'Người quan tâm công nghệ'},
  retention:{brand:'Green Market',goal:'retention',offer:'Gửi lời cảm ơn khách hàng đã đồng hành cùng thương hiệu trong năm qua.',industry:'retail',audience:'Khách hàng thân thiết'}
};
document.querySelectorAll('[data-preset]').forEach(btn=>btn.addEventListener('click',()=>{
  const preset=presets[btn.dataset.preset];if(!preset)return;
  refs.brand.value=preset.brand;refs.offer.value=preset.offer;refs.industry.value=preset.industry;refs.audience.value=preset.audience;
  document.querySelector(`input[name="goal"][value="${preset.goal}"]`).checked=true;
  updateBrief();
  if(location.hash==='#studio')navigatePage('studio');else location.hash='studio';
  setStep(1);
  toast('Đã điền thông tin mẫu. Bạn có thể điều chỉnh trước khi tạo email.');
}));
