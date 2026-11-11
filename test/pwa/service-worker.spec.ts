import {test,expect} from '@playwright/test';
test('compiled worker handles synthetic push privately and PWA works offline',async({page,context})=>{
 await page.goto('/register');await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));await page.reload();
 const worker=context.serviceWorkers()[0];expect(worker).toBeTruthy();
 await page.evaluate(async()=>{await new Promise<void>((resolve,reject)=>{const r=indexedDB.open('morfi-push',1);r.onupgradeneeded=()=>r.result.createObjectStore('values');r.onsuccess=()=>{const tx=r.result.transaction('values','readwrite');tx.objectStore('values').put('fixture-seller','owner');tx.oncomplete=()=>{r.result.close();resolve();};};r.onerror=()=>reject(r.error);});});
 await worker.evaluate(()=>{const state=globalThis as unknown as {testNotices:{title:string;body?:string}[]};state.testNotices=[];Object.defineProperty(self.registration,'showNotification',{value:async(title:string,options?:NotificationOptions)=>{state.testNotices.push({title,body:options?.body});}});});
 const payload={userId:'fixture-seller',orderId:'order-1',businessId:'business-1',number:2};
 const send=async(p:typeof payload)=>worker.evaluate(async p=>{let pending:Promise<unknown>|null=null;const event=new Event('push');Object.defineProperty(event,'data',{value:{json:()=>p}});Object.defineProperty(event,'waitUntil',{value:(promise:Promise<unknown>)=>{pending=promise;}});self.dispatchEvent(event);if(pending)await pending;},p);
 await send(payload);await send(payload);await send({...payload,userId:'another-account',orderId:'order-2'});
 const notices=await worker.evaluate(()=>(globalThis as unknown as {testNotices:{title:string;body?:string}[]}).testNotices);expect(notices).toEqual([{title:'Nuevo pedido #2',body:'Abrí MORFI para revisarlo.'}]);
 const keys=await page.evaluate(async()=>{const requests=[] as string[];for(const key of await caches.keys()){const cache=await caches.open(key);requests.push(...(await cache.keys()).map(r=>r.url));}return requests;});expect(keys.every(k=>!k.includes('/auth/v1')&&!k.includes('/rest/v1'))).toBe(true);
 await context.setOffline(true);await page.goto('/register');await expect(page.getByRole('heading',{name:'Registrate para pedir'})).toBeVisible();
});
