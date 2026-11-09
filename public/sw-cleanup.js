/*
 * Minha Escola — limpeza de caches antigos do service worker (incluído via importScripts).
 *
 * Versões anteriores do PWA usavam as regras padrão do next-pwa e podiam guardar dados
 * privados no Cache Storage:
 *   "apis"         -> respostas GET de /api/* (dados, PDFs)
 *   "cross-origin" -> respostas do Supabase (REST, Auth, URLs assinadas de documentos)
 *   "others"       -> páginas dinâmicas gravadas sem respeitar no-store
 * Na ativação de uma nova versão, apaga SOMENTE esses nomes exatos. O Cache Storage é isolado
 * por origem (nada de outros sites/aplicativos é acessível daqui); localStorage, IndexedDB e
 * cookies não são tocados. A política nova (pwa/runtimeCaching.js) não usa esses nomes.
 */
(function (scope) {
  var LEGACY_PRIVATE_CACHES = ["apis", "cross-origin", "others"];

  function cleanupLegacyPrivateCaches(cacheStorage) {
    if (!cacheStorage || typeof cacheStorage.keys !== "function") return Promise.resolve([]);
    return cacheStorage
      .keys()
      .then(function (names) {
        var targets = names.filter(function (name) {
          return LEGACY_PRIVATE_CACHES.indexOf(name) >= 0;
        });
        return Promise.all(
          targets.map(function (name) {
            return cacheStorage
              .delete(name)
              .then(function (ok) {
                return ok ? name : null;
              })
              .catch(function () {
                return null;
              });
          })
        );
      })
      .then(function (removed) {
        return removed.filter(Boolean);
      })
      .catch(function () {
        return [];
      });
  }

  scope.__minhaEscolaCleanupLegacyPrivateCaches = cleanupLegacyPrivateCaches;
  scope.__minhaEscolaLegacyPrivateCaches = LEGACY_PRIVATE_CACHES.slice();

  if (typeof scope.addEventListener === "function") {
    scope.addEventListener("activate", function (event) {
      event.waitUntil(cleanupLegacyPrivateCaches(scope.caches));
    });
  }
})(self);
