const CACHE='life-compass-ai-os-v2.5.0';
const CACHE_PREFIX='life-compass-ai-os-';
const HOME_URL=new URL('./index.html',self.location.href).href;
const ASSETS=['./index.html','./styles.css?v=2.5.0','./manifest.webmanifest?v=2.5.0','./assets/icon.svg','./src/app.js?v=2.5.0','./src/model.js','./src/storage.js','./src/migration.js','./src/ai.js','./src/integrations.js'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys()
    .then(keys=>Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim()));
});

async function networkFirst(request,{navigation=false}={}) {
  const cache=await caches.open(CACHE);
  try {
    const response=await fetch(request,{cache:'no-store'});
    if(response.ok)await cache.put(navigation?HOME_URL:request,response.clone());
    return response;
  } catch (_) {
    const cached=await cache.match(navigation?HOME_URL:request,{ignoreSearch:navigation});
    if(cached)return cached;
    throw _;
  }
}

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  event.respondWith(networkFirst(event.request,{navigation:event.request.mode==='navigate'}));
});
