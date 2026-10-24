// iOS reserves both horizontal safe areas even when the cutout is on one side.
// Use its portrait-relative angle only in the installed phone landscape view.
// Unknown devices/orientations keep the platform's conservative insets.
const phoneLandscape = matchMedia('(orientation: landscape) and (min-width: 560px) and (max-height: 600px)');
function updateDeviceViewport() {
  const root = document.documentElement;
  // Apple's angle is relative to portrait: +90 puts the phone's top on the left.
  // https://developer.apple.com/documentation/webkitjs/domwindow/1632568-orientation
  const angle = window.orientation;
  const cutout = navigator.standalone === true && phoneLandscape.matches
    ? angle === 90 ? 'left' : angle === -90 ? 'right' : ''
    : '';
  if (cutout) root.dataset.landscapeCutout = cutout;
  else delete root.dataset.landscapeCutout;
}
phoneLandscape.addEventListener('change', updateDeviceViewport);
window.addEventListener('orientationchange', updateDeviceViewport);
window.addEventListener('pageshow', updateDeviceViewport);
updateDeviceViewport();

// In a short landscape view, detail and its surrounding chart share the screen.
// This only folds navigation away; it does not enter browser/chart fullscreen.
let normalReading = null;
let retreating = [];
let restoreOnClose = false;
const lessMotion = matchMedia('(prefers-reduced-motion: reduce)');
const phaseKey = () => new URL(location.href).searchParams.get('phase') || '';
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !phoneLandscape.matches) return;
  restoreOnClose = button.dataset.action === 'close-dialog';
  if (!button.dataset.task || document.body.classList.contains('has-detail') || document.body.classList.contains('chart-fullscreen')) return;
  const chart = document.querySelector('.plan-scroll');
  normalReading = {x:scrollX,y:scrollY,left:chart?.scrollLeft||0,top:chart?.scrollTop||0,phase:phaseKey()};
  retreating = lessMotion.matches ? [] : [...document.querySelectorAll('.view-nav,.phase-overview')].map(element => ({element:element.cloneNode(true),rect:element.getBoundingClientRect()}));
}, true);

function syncDetailWorkspace() {
  const body = document.body;
  const focused = phoneLandscape.matches && body.classList.contains('has-detail') && Boolean(document.querySelector('.chart-workspace'));
  const wasFocused = body.classList.contains('compact-detail');
  if (focused === wasFocused) return;
  body.classList.toggle('compact-detail', focused);
  if (focused && !body.classList.contains('chart-fullscreen') && !lessMotion.matches) {
    const main = document.querySelector('main').getBoundingClientRect();
    const layer = document.createElement('div');
    layer.className = 'workspace-retreat'; layer.inert = true;
    layer.setAttribute('aria-hidden','true'); layer.style.right = `${innerWidth-main.right}px`;
    for (const {element,rect} of retreating) {
      if (rect.bottom <= 0 || rect.top >= innerHeight) continue;
      element.removeAttribute('id');
      element.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));
      element.style.cssText=`position:absolute;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;margin:0;`;
      layer.append(element);
    }
    if (layer.childElementCount) {
      body.append(layer);
      const animation=layer.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-20px)'}],{duration:180,easing:'cubic-bezier(.2,.7,.2,1)'});
      animation.finished.finally(()=>layer.remove());
    }
    document.querySelector('.chart-workspace').animate([{opacity:.5,transform:'translateY(10px)'},{opacity:1,transform:'none'}],{duration:200,easing:'cubic-bezier(.2,.7,.2,1)'});
  }
  retreating=[];
  if (!focused && restoreOnClose && normalReading) {
    const reading=normalReading; normalReading=null; restoreOnClose=false;
    requestAnimationFrame(()=>{
      if (body.classList.contains('has-detail')) return;
      window.scrollTo(reading.x,reading.y);
      const chart=document.querySelector('.plan-scroll');
      if (chart && phaseKey()===reading.phase) {chart.scrollLeft=reading.left;chart.scrollTop=reading.top;}
    });
  }
}
new MutationObserver(syncDetailWorkspace).observe(document.body,{attributes:true,attributeFilter:['class']});
new MutationObserver(syncDetailWorkspace).observe(document.querySelector('#content'),{childList:true});
phoneLandscape.addEventListener('change',syncDetailWorkspace);
syncDetailWorkspace();
