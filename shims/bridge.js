(function () {
  if (window.__ocBridgeDone) return;
  window.__ocBridgeDone = 1;

  window.addEventListener(
    "error",
    function (e) {
      var m = (e && (e.message || (e.error && e.error.message))) || "";
      if (
        m.indexOf("ResizeObserver") !== -1 ||
        m.indexOf("Transport: Failed to fetch") !== -1 ||
        m.indexOf("clone terminal") !== -1
      ) {
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        if (e.preventDefault) e.preventDefault();
        return true;
      }
    },
    true
  );

  window.addEventListener(
    "unhandledrejection",
    function (e) {
      var m = (e && e.reason && (e.reason.message || String(e.reason))) || "";
      if (
        m.indexOf("ResizeObserver") !== -1 ||
        m.indexOf("Transport: Failed to fetch") !== -1 ||
        m.indexOf("clone terminal") !== -1
      ) {
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        if (e.preventDefault) e.preventDefault();
        return true;
      }
    },
    true
  );

  var realFetch = window.fetch.bind(window);
  window.__ocRealFetch = realFetch;

  function getUrlString(input) {
    if (typeof input === "string") return input;
    if (!input) return "";
    if (typeof input.href === "string") return input.href;
    if (typeof input.url === "string") return input.url;
    try {
      return String(input);
    } catch (e) {
      return "";
    }
  }

  function install() {
    if (window.__ocBridgeInstalled) return;
    window.__ocBridgeInstalled = 1;
    console.log("[oc-bridge] actif : interception temps réel /api/event avec synchronisation instantanée");

    window.fetch = function (input, init) {
      try {
        var url = getUrlString(input);
        var method = (
          (init && init.method) ||
          (input && input.method) ||
          "GET"
        ).toUpperCase();

        if (
          method === "GET" &&
          url.indexOf("/api/event") !== -1 &&
          url.indexOf("__proxy") === -1
        ) {
          return synthetic(init);
        }
      } catch (e) {}
      return realFetch(input, init);
    };
  }

  function synthetic(init) {
    var enc = new TextEncoder();
    var stopped = false;
    var localCtrl = new AbortController();
    var signal = init && init.signal;

    if (signal) {
      if (signal.aborted) stopped = true;
      else {
        signal.addEventListener("abort", function () {
          stopped = true;
          try {
            localCtrl.abort();
          } catch (e) {}
        });
      }
    }

    var stream = new ReadableStream({
      start: function (ctrl) {
        var hello = {
          id: "evt_shim_" + Date.now().toString(36),
          type: "server.connected",
          data: {},
        };
        try {
          ctrl.enqueue(enc.encode("data: " + JSON.stringify(hello) + "\n\n"));
        } catch (e) {}
        pump(ctrl);
      },
      cancel: function () {
        stopped = true;
        try {
          localCtrl.abort();
        } catch (e) {}
      },
    });

    function pump(ctrl) {
      var last = -1;
      function loop() {
        if (stopped) {
          try {
            ctrl.close();
          } catch (e) {}
          return;
        }

        realFetch("/__proxy/events?since=" + last + "&wait=8000", {
          signal: localCtrl.signal,
          cache: "no-store",
        })
          .then(function (r) {
            return r.ok ? r.json() : { events: [], last: last };
          })
          .then(function (j) {
            if (stopped) {
              try {
                ctrl.close();
              } catch (e) {}
              return;
            }
            if (typeof j.last === "number") last = j.last;
            var evs = j.events || [];
            for (var i = 0; i < evs.length; i++) {
              try {
                ctrl.enqueue(
                  enc.encode("data: " + JSON.stringify(evs[i]) + "\n\n")
                );
              } catch (e) {
                stopped = true;
                break;
              }
            }
            try {
              ctrl.enqueue(enc.encode(": ka\n\n"));
            } catch (e) {}
            if (!stopped) loop();
          })
          .catch(function () {
            if (stopped) return;
            // Réessayer après 800ms pour ne jamais couper le flux d'événements
            setTimeout(loop, 800);
          });
      }
      loop();
    }

    return Promise.resolve(
      new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "X-Accel-Buffering": "no",
        },
      })
    );
  }

  install();
})();