const toggle=document.querySelector('.menu-toggle');const nav=document.querySelector('.main-nav');
if(toggle&&nav){toggle.addEventListener('click',()=>{const open=nav.classList.toggle('open');toggle.setAttribute('aria-expanded',String(open));});nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{nav.classList.remove('open');toggle.setAttribute('aria-expanded','false');}));}
const year=document.getElementById('year');if(year)year.textContent=new Date().getFullYear();
async function submitPortalForm(form, endpoint) {
  const status=form.querySelector('.portal-status, .form-status');
  const button=form.querySelector('button[type="submit"]');
  status.textContent='Submitting…';status.classList.remove('error');button.disabled=true;
  try {
    const response=await fetch(endpoint,{method:'POST',body:new FormData(form)});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Unable to submit. Please try again.');
    status.textContent=result.message||'Thank you. Your submission has been received.';form.reset();
  } catch(error) {
    status.textContent=error.message||'Something went wrong. Please try again or contact PDL by phone.';status.classList.add('error');
  } finally {button.disabled=false;}
}
const quoteForm=document.getElementById('quoteForm');
if(quoteForm)quoteForm.addEventListener('submit',e=>{e.preventDefault();if(quoteForm.reportValidity())submitPortalForm(quoteForm,'/api/enquiries')});
const careerForm=document.getElementById('careerForm');
if(careerForm)careerForm.addEventListener('submit',e=>{e.preventDefault();if(careerForm.reportValidity())submitPortalForm(careerForm,'/api/careers')});
const partnerForm=document.getElementById('partnerForm');
if(partnerForm)partnerForm.addEventListener('submit',e=>{e.preventDefault();if(partnerForm.reportValidity())submitPortalForm(partnerForm,'/api/partners')});
