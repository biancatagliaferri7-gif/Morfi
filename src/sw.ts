/// <reference lib="WebWorker" />
import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  precacheAndRoute,
  createHandlerBoundToURL,
} from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { pushOwner, claimOrderNotice } from "./orders/pushStore";
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[];
};
self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api/, /^\/auth\/callback/],
  }),
);
registerRoute(
  ({ url }) =>
    /^https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/public\/morfi-catalog\//.test(
      url.href,
    ),
  new CacheFirst({
    cacheName: "morfi-public-catalog-images",
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 604800 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
);
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let p;
      try {
        p = event.data?.json();
      } catch {
        return;
      }
      if (!p?.userId || !p.orderId || (await pushOwner()) !== p.userId) return;
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const visible = clients.filter(
        (c) =>
          (c as WindowClient).visibilityState === "visible" &&
          new URL(c.url).pathname === "/business",
      );
      if (visible.length) {
        visible.forEach((c) =>
          c.postMessage({ ...p, type: "MORFI_NEW_ORDER" }),
        );
        return;
      }
      if (!(await claimOrderNotice("system:" + p.userId + ":" + p.orderId)))
        return;
      await self.registration.showNotification(
        "Nuevo pedido" + (p.number ? " #" + p.number : ""),
        {
          body: "Abrí MORFI para revisarlo.",
          icon: "/icono-morfi-192.png",
          badge: "/icono-morfi-192.png",
          tag: "morfi-order-" + p.orderId,
          data: {
            orderId: p.orderId,
            businessId: p.businessId,
            userId: p.userId,
          },
        },
      );
    })(),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const p = event.notification.data;
      if (!p || (await pushOwner()) !== p.userId) return;
      const path =
        "/business?section=pedidos&business=" +
        encodeURIComponent(p.businessId) +
        "&order=" +
        encodeURIComponent(p.orderId);
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      if (clients[0]) {
        await (clients[0] as WindowClient).navigate(path);
        await (clients[0] as WindowClient).focus();
      } else await self.clients.openWindow(path);
    })(),
  );
});
