// Applies the saved theme before first paint. Kept as a file so the CSP needs no inline scripts.
try{var t=localStorage.getItem("fretphrase-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}
