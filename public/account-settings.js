/* Account settings and owner controls. No credentials are persisted in browser storage. */
window.setupAccountControls = ({api,json,toast,openDialog,closeDialog,loadStorage,username,session,refreshSession}) => {
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const status=(id,text,error=false)=>{ $(id).textContent=text;$(id).classList.toggle('error',error); };
  const currentUsername=()=>String(username?.()??'');
  let security=null,verifyPending=null,confirmPending=null,busy=false,mfaBusy=false,deleteBusy=false,emailBusy=false,emailPending='',users=[],page=0,hasMore=false,selected=null,searchTimer,requestId=0,codes=[];
  const date=value=>new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  const cancelled=()=>Object.assign(new Error('Cancelled'),{name:'AbortError'});
  const report=(id,error)=>{if(error.name!=='AbortError')status(id,error.message,true);};
  function selectTab(name){
    document.querySelectorAll('[data-settings-tab]').forEach(button=>{
      const active=button.dataset.settingsTab===name;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
      $(`settings-${button.dataset.settingsTab}`).hidden=!active;
    });
  }
  document.querySelectorAll('[data-settings-tab]').forEach(button=>{
    button.addEventListener('click',()=>selectTab(button.dataset.settingsTab));
    button.addEventListener('keydown',event=>{
      const buttons=[...document.querySelectorAll('[data-settings-tab]')],index=buttons.indexOf(button);
      const next=event.key==='ArrowRight'||event.key==='ArrowDown'?(index+1)%buttons.length:event.key==='ArrowLeft'||event.key==='ArrowUp'?(index+buttons.length-1)%buttons.length:event.key==='Home'?0:event.key==='End'?buttons.length-1:null;
      if(next!==null){event.preventDefault();selectTab(buttons[next].dataset.settingsTab);buttons[next].focus();}
    });
  });
  async function refreshSecurity(){
    security=await api('security');
    $('security-sessions').textContent=`${security.active_sessions} active ${security.active_sessions===1?'session':'sessions'}, including this device.`;
    $('mfa-badge').textContent=security.mfa_enabled?'On':'Off';$('mfa-badge').classList.toggle('is-on',security.mfa_enabled);
    $('mfa-detail').textContent=security.mfa_enabled?'Authenticator code required at sign-in.':'Add a code from your authenticator app.';
    $('mfa-enable').hidden=security.mfa_enabled;$('mfa-enable').disabled=!security.mfa_available;
    if(!security.mfa_available&&!security.mfa_enabled)$('mfa-detail').textContent='Setup temporarily unavailable.';
    $('mfa-disable').hidden=!security.mfa_enabled;$('recovery-row').hidden=!security.mfa_enabled;
    $('recovery-remaining').textContent=`${security.recovery_codes_remaining} unused codes`;
    return security;
  }
  function emailSession(){ return session?.()||{}; }
  function renderEmail(){
    const state=emailSession();
    $('email-row').hidden=!state.mailEnabled;
    if(!state.mailEnabled)return;
    const has=!!state.contactEmail,verified=has&&state.contactEmailVerified===true;
    $('email-detail').textContent=has?state.contactEmail:'No email added.';
    $('email-badge').hidden=!has;$('email-badge').textContent=verified?'Verified':'Not verified';$('email-badge').classList.toggle('is-on',verified);
    $('email-open').textContent=has?'Change':'Add email';
    $('email-resend').hidden=!has||verified;
    $('email-remove').hidden=!has;
  }
  async function refreshEmail(){
    try{ if(refreshSession) await refreshSession(); }catch{ /* Keep the last known address. */ }
    renderEmail();
  }
  function openEmailDialog(mode='set'){
    const state=emailSession();
    if(!state.mailEnabled)return;
    const resend=mode==='resend';
    $('email-form').reset();status('email-status','');
    $('email-title').textContent=resend?'Resend confirmation link':state.contactEmail?'Change email':'Add email';
    $('email-hint').textContent=resend?'Enter the same address to send a new confirmation link.':'We’ll send a link to confirm this address.';
    $('email-address').value=resend?emailPending:'';
    $('email-factor').hidden=!security?.mfa_enabled;$('email-code').required=!!security?.mfa_enabled;
    $('email-submit').textContent=resend?'Send link':'Send confirmation link';
    closeDialog('account-dialog');openDialog('email-dialog',$('email-address').value?'email-password':'email-address');
  }
  async function open(){
    selectTab('general');status('security-status','');renderEmail();openDialog('account-dialog');
    await Promise.allSettled([loadStorage().catch(error=>status('account-storage',error.message,true)),refreshSecurity().catch(error=>status('security-status',error.message,true)),refreshEmail()]);
  }
  async function verify(){
    await refreshSecurity();
    $('verify-form').reset();$('verify-factor').hidden=!security.mfa_enabled;$('verify-code').required=security.mfa_enabled;status('verify-status','');
    openDialog('verify-dialog','verify-password');
    return new Promise((resolve,reject)=>{verifyPending={resolve,reject};});
  }
  $('verify-form').addEventListener('submit',async event=>{
    event.preventDefault();if($('verify-submit').disabled)return;
    $('verify-submit').disabled=true;status('verify-status','');
    try{
      await api('auth/elevate',json('POST',{current_password:$('verify-password').value,code:$('verify-code').value}));
      const pending=verifyPending;verifyPending=null;closeDialog('verify-dialog');pending?.resolve();
    }catch(error){report('verify-status',error);}finally{$('verify-submit').disabled=false;}
  });
  $('verify-dialog').addEventListener('close',()=>{$('verify-form').reset();verifyPending?.reject(cancelled());verifyPending=null;});
  $('delete-account-open').addEventListener('click',()=>{
    if($('delete-account-open').disabled)return;
    closeDialog('account-dialog');$('delete-account-form').reset();
    $('delete-account-factor').hidden=!security?.mfa_enabled;$('delete-account-code').required=!!security?.mfa_enabled;
    $('delete-account-submit').disabled=true;status('delete-account-status','');
    openDialog('delete-account-dialog','delete-account-confirm');
  });
  $('delete-account-confirm').addEventListener('input',()=>{
    $('delete-account-submit').disabled=deleteBusy||$('delete-account-confirm').value!==currentUsername();
  });
  $('delete-account-form').addEventListener('submit',async event=>{
    event.preventDefault();if(deleteBusy||$('delete-account-submit').disabled)return;
    deleteBusy=true;status('delete-account-status','');
    const controls=[...$('delete-account-form').querySelectorAll('button,input')];
    controls.forEach(control=>control.disabled=true);$('delete-account-submit').textContent='Deleting…';
    try{
      await api('auth/delete-account',json('POST',{confirm:$('delete-account-confirm').value,current_password:$('delete-account-password').value,code:$('delete-account-code').value}));
      try{localStorage.removeItem('score-studio-session');}catch{}
      closeDialog('delete-account-dialog');location.replace('/');
    }catch(error){
      report('delete-account-status',error);controls.forEach(control=>control.disabled=false);
      $('delete-account-submit').textContent='Delete my account';
      $('delete-account-submit').disabled=$('delete-account-confirm').value!==currentUsername();
      deleteBusy=false;
    }
  });
  $('delete-account-dialog').addEventListener('close',()=>{
    if(deleteBusy)return;
    $('delete-account-form').reset();$('delete-account-factor').hidden=true;$('delete-account-code').required=false;
    $('delete-account-submit').disabled=true;$('delete-account-submit').textContent='Delete my account';status('delete-account-status','');
  });
  $('email-open').addEventListener('click',()=>openEmailDialog('set'));
  $('email-resend').addEventListener('click',()=>openEmailDialog('resend'));
  $('email-remove').addEventListener('click',async()=>{
    if(!await confirmAction('Remove email?','You will no longer be able to reset your password by email. Your recovery key still works.',null,'Remove'))return;
    $('email-remove').disabled=true;status('security-status','');
    try{await secure(()=>api('auth/email-remove',json('POST',{})));await refreshEmail();toast('Email removed.');}
    catch(error){report('security-status',error);}
    finally{$('email-remove').disabled=false;}
  });
  $('email-form').addEventListener('submit',async event=>{
    event.preventDefault();if(emailBusy)return;
    const email=$('email-address').value.trim();
    emailBusy=true;
    const controls=[...$('email-form').querySelectorAll('button,input')];controls.forEach(control=>control.disabled=true);
    status('email-status','');$('email-submit').textContent='Sending…';
    try{
      await api('auth/email-set',json('POST',{email,current_password:$('email-password').value,code:$('email-code').value}));
      emailPending=email;closeDialog('email-dialog');
      toast(`We sent a confirmation link to ${email}. It expires in 24 hours.`);
      await refreshEmail();
    }catch(error){report('email-status',error);}
    finally{
      emailBusy=false;controls.forEach(control=>control.disabled=false);
      $('email-submit').textContent=$('email-title').textContent==='Resend confirmation link'?'Send link':'Send confirmation link';
    }
  });
  $('email-dialog').addEventListener('close',()=>{
    $('email-form').reset();$('email-factor').hidden=true;$('email-code').required=false;status('email-status','');
  });
  async function secure(action){
    try{return await action();}catch(error){if(error.code!=='reauth_required')throw error;}
    await verify();return action();
  }
  function confirmAction(title,message,email=null,label='Confirm'){
    $('confirm-account-title').textContent=title;$('confirm-account-message').textContent=message;
    $('confirm-email-field').hidden=!email;$('confirm-account-email').value='';$('confirm-account-email').required=!!email;
    $('confirm-account-submit').textContent=label;
    openDialog('confirm-account-dialog',email?'confirm-account-email':'confirm-account-submit');
    return new Promise(resolve=>{confirmPending={resolve,email};});
  }
  $('confirm-account-form').addEventListener('submit',event=>{
    event.preventDefault();if(!confirmPending)return;
    if(confirmPending.email&&$('confirm-account-email').value!==confirmPending.email){$('confirm-account-email').setCustomValidity('Enter the exact account email.');$('confirm-account-email').reportValidity();return;}
    const pending=confirmPending;confirmPending=null;closeDialog('confirm-account-dialog');pending.resolve(true);
  });
  $('confirm-account-email').addEventListener('input',()=>$('confirm-account-email').setCustomValidity(''));
  $('confirm-account-dialog').addEventListener('close',()=>{confirmPending?.resolve(false);confirmPending=null;$('confirm-account-email').setCustomValidity('');});
  for(const [id,scope] of [['sessions-others','others'],['sessions-all','all']])$(id).addEventListener('click',async()=>{
    if(scope==='all'&&!await confirmAction('Sign out everywhere?','You will need to sign in again on this device and every other device.',null,'Sign out'))return;
    $(id).disabled=true;status('security-status','');
    try{await secure(()=>api('security',json('POST',{scope})));if(scope==='all'){location.reload();return;}await refreshSecurity();toast('Other sessions signed out.');}
    catch(error){report('security-status',error);}finally{$(id).disabled=false;}
  });
  function showUsersView(view){
    for(const name of ['overview','detail','create'])$(name==='overview'?'users-overview':`user-${name}`).hidden=view!==name;
    status('users-status','');
  }
  function renderUsers(){
    $('users-list').innerHTML=users.length?`<div class="users-columns" aria-hidden="true"><span>Account</span><span>Songs</span><span></span></div>`+users.map(user=>`<button class="user-list-row" type="button" data-manage-id="${esc(user.id)}" aria-label="Manage ${esc(user.email)}"><span class="user-list-identity"><span class="avatar" aria-hidden="true">${esc(user.email[0].toUpperCase())}</span><span><strong>${esc(user.email)}</strong><small>${user.owner?'Owner':user.suspended?'Suspended':'Active'}</small></span></span><span class="user-song-count">${user.songs}</span><span class="user-manage-label">Manage <span aria-hidden="true">›</span></span></button>`).join(''):'<p class="users-empty">No users found.</p>';
    $('users-pagination').hidden=page===0&&!hasMore;$('users-prev').disabled=page===0;$('users-next').disabled=!hasMore;$('users-page').textContent=`Page ${page+1}`;
  }
  function renderSelected(){
    if(!selected)return;
    $('user-avatar').textContent=selected.email[0].toUpperCase();$('user-detail-email').textContent=selected.email;
    $('user-detail-meta').textContent=`${selected.owner?'Owner · ':''}${selected.songs} ${selected.songs===1?'song':'songs'} · Joined ${date(selected.created_at)}`;
    $('user-access-badge').textContent=selected.suspended?'Suspended':'Active';$('user-access-badge').classList.toggle('is-on',!selected.suspended);
    $('user-access-detail').textContent=selected.owner?'Owner account is protected.':selected.suspended?'Sign-in and shared links are disabled.':'Can sign in and share songs.';
    $('user-suspend').hidden=selected.owner;$('user-suspend').textContent=selected.suspended?'Reactivate':'Suspend';
    $('user-revoke').closest('.settings-row').hidden=selected.owner;$('user-delete').hidden=selected.owner;
  }
  async function loadUsers(){
    const request=++requestId,result=await api(`owner/users?q=${encodeURIComponent($('users-search').value)}&page=${page}`);
    if(request!==requestId)return;
    users=result.users;hasMore=result.has_more;renderUsers();
    if(selected){selected=users.find(user=>user.id===selected.id)||null;if(selected)renderSelected();else showUsersView('overview');}
  }
  document.querySelectorAll('[data-manage-users]').forEach(button=>button.addEventListener('click',async()=>{
    closeDialog('account-dialog');page=0;selected=null;$('users-search').value='';showUsersView('overview');openDialog('users-dialog','users-search');
    try{await loadUsers();}catch(error){report('users-status',error);}
  }));
  $('users-search').addEventListener('input',()=>{clearTimeout(searchTimer);requestId++;searchTimer=setTimeout(async()=>{page=0;try{await loadUsers();}catch(error){report('users-status',error);}},200);});
  for(const [id,delta] of [['users-prev',-1],['users-next',1]])$(id).addEventListener('click',async()=>{page=Math.max(0,page+delta);try{await loadUsers();}catch(error){report('users-status',error);}});
  $('users-list').addEventListener('click',event=>{const row=event.target.closest('[data-manage-id]');if(!row)return;selected=users.find(user=>user.id===row.dataset.manageId);renderSelected();showUsersView('detail');$('user-detail-email').tabIndex=-1;$('user-detail-email').focus();});
  document.querySelectorAll('[data-users-back]').forEach(button=>button.addEventListener('click',()=>{if(busy)return;selected=null;$('user-create-form').reset();showUsersView('overview');$('users-search').focus();}));
  $('user-add').addEventListener('click',()=>{selected=null;$('user-create-form').reset();showUsersView('create');$('user-email').focus();});
  async function ownerAction(body,message){
    if(busy)return;busy=true;status('users-status','');
    const controls=[...$('users-dialog').querySelectorAll('button,input,select')];controls.forEach(control=>control.disabled=true);
    let saved=false;
    try{
      await secure(()=>api('owner/users',json('POST',body)));saved=true;
      if(body.action==='create'){$('user-create-form').reset();page=0;$('users-search').value='';showUsersView('overview');}
      toast(message);await loadUsers();
    }catch(error){report('users-status',saved?new Error('Saved. Refresh the user list to see the change.'):error);}
    finally{busy=false;controls.forEach(control=>control.disabled=false);$('users-prev').disabled=page===0;$('users-next').disabled=!hasMore;}
  }
  $('user-create-form').addEventListener('submit',event=>{event.preventDefault();ownerAction({action:'create',email:$('user-email').value,password:$('user-password').value},'Account created.');});
  $('user-suspend').addEventListener('click',async()=>{const user=selected;if(!user)return;const action=user.suspended?'restore':'suspend';if(action==='suspend'&&!await confirmAction('Suspend account?',`${user.email} will be signed out. Their shared links will stop working until reactivated.`,null,'Suspend'))return;ownerAction({action,id:user.id},action==='restore'?'Account reactivated.':'Account suspended.');});
  $('user-revoke').addEventListener('click',()=>{if(selected)ownerAction({action:'revoke-sessions',id:selected.id},'User signed out.');});
  $('user-delete').addEventListener('click',async()=>{const user=selected;if(user&&await confirmAction('Delete account?',`Permanently delete ${user.email} and all their cloud songs. Existing backups expire separately.`,user.email,'Delete account'))ownerAction({action:'delete',id:user.id,confirm_email:user.email},'Account deleted.');});
  $('users-dialog').addEventListener('close',()=>{$('user-create-form').reset();clearTimeout(searchTimer);requestId++;});
  function showRecovery(values){
    codes=values;$('mfa-title').textContent='Save recovery codes';$('mfa-setup').hidden=true;$('mfa-codes').hidden=false;
    $('mfa-qr').replaceChildren();$('mfa-secret').textContent='';$('mfa-code').value='';
    $('recovery-codes').innerHTML=codes.map(code=>`<code>${esc(code)}</code>`).join('');$('recovery-saved').checked=false;$('recovery-done').disabled=true;
    if(!$('mfa-dialog').open)openDialog('mfa-dialog');
  }
  $('mfa-enable').addEventListener('click',async()=>{
    $('mfa-enable').disabled=true;status('security-status','');
    try{
      const setup=await secure(()=>api('auth/mfa-start',json('POST',{})));
      const qr=qrcode(0,'M');qr.addData(setup.uri);qr.make();
      $('mfa-qr').innerHTML=qr.createSvgTag({cellSize:4,margin:16,scalable:true});$('mfa-secret').textContent=setup.secret;
      $('mfa-title').textContent='Set up two-factor';$('mfa-setup').hidden=false;$('mfa-codes').hidden=true;$('mfa-code').value='';status('mfa-status','');openDialog('mfa-dialog','mfa-code');
    }catch(error){report('security-status',error);}finally{$('mfa-enable').disabled=false;}
  });
  $('mfa-confirm-form').addEventListener('submit',async event=>{
    event.preventDefault();if(mfaBusy)return;mfaBusy=true;$('mfa-confirm').disabled=true;status('mfa-status','');
    try{const result=await secure(()=>api('auth/mfa-confirm',json('POST',{code:$('mfa-code').value})));showRecovery(result.recovery_codes);await refreshSecurity();}
    catch(error){report('mfa-status',error);}finally{mfaBusy=false;$('mfa-confirm').disabled=false;}
  });
  $('mfa-disable').addEventListener('click',async()=>{
    if(!await confirmAction('Turn off two-factor?','Your account will be protected by your password alone. Other sessions will be signed out.',null,'Turn off'))return;
    $('mfa-disable').disabled=true;
    try{await secure(()=>api('auth/mfa-disable',json('POST',{})));await refreshSecurity();toast('Two-factor turned off.');}catch(error){report('security-status',error);}finally{$('mfa-disable').disabled=false;}
  });
  $('mfa-recovery').addEventListener('click',async()=>{
    if(!await confirmAction('Replace recovery codes?','Your previous recovery codes will stop working.',null,'Replace codes'))return;
    $('mfa-recovery').disabled=true;
    try{const result=await secure(()=>api('auth/mfa-recovery',json('POST',{})));showRecovery(result.recovery_codes);await refreshSecurity();}catch(error){report('security-status',error);}finally{$('mfa-recovery').disabled=false;}
  });
  const copy=async text=>{try{await navigator.clipboard.writeText(text);toast('Copied.');}catch{toast('Copy unavailable. Select and copy the text.',true);}};
  $('mfa-copy-secret').addEventListener('click',()=>copy($('mfa-secret').textContent));
  $('recovery-copy').addEventListener('click',()=>copy(codes.join('\n')));
  $('recovery-download').addEventListener('click',()=>{
    const url=URL.createObjectURL(new Blob(['Fretlark recovery codes\nKeep private. Each code works once.\n\n'+codes.join('\n')],{type:'text/plain'})),link=document.createElement('a');link.href=url;link.download='fretlark-recovery-codes.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  $('recovery-saved').addEventListener('change',()=>$('recovery-done').disabled=!$('recovery-saved').checked);
  $('recovery-done').addEventListener('click',()=>{if($('recovery-saved').checked)closeDialog('mfa-dialog');});
  $('mfa-dialog').addEventListener('close',()=>{codes=[];$('mfa-qr').replaceChildren();$('mfa-secret').textContent='';$('recovery-codes').replaceChildren();$('mfa-code').value='';});
  function canClose(id){
    if(id==='users-dialog'&&busy||id==='mfa-dialog'&&mfaBusy||id==='delete-account-dialog'&&deleteBusy||id==='verify-dialog'&&$('verify-submit').disabled||id==='email-dialog'&&emailBusy)return false;
    if(id==='mfa-dialog'&&codes.length&&!$('recovery-saved').checked){toast('Save your recovery codes, then check the confirmation.',true);return false;}
    return true;
  }
  return {open,secure,canClose};
};
