// Shared links open the read-only viewer layout before the editor script runs.
if(new URLSearchParams(location.search).has("share"))document.body.classList.add("viewer","hide-palette","hide-inspector");
