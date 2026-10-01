/* Client-side PDF packager for the market-participation report.
   Clicking "Download PDF" builds an A4 PDF from the live HTML pages and
   sends it to the browser download, so the repo does not need a stale .pdf. */
(function () {
  var LIBS = [
    'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js'
  ];
  var busy = false;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-pdf-lib="' + src + '"]')) {
        resolve();
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.setAttribute('data-pdf-lib', src);
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function loadLibs() {
    var chain = Promise.resolve();
    LIBS.forEach(function (src) {
      chain = chain.then(function () { return loadScript(src); });
    });
    return chain;
  }

  function initials(name) {
    return String(name || '')
      .split(/\s+/)
      .filter(Boolean)
      .map(function (w) { return w.charAt(0); })
      .join('')
      .toUpperCase();
  }

  function fileName(anchor) {
    var href = (anchor.getAttribute('href') || '').split('?')[0].split('#')[0];
    var fromHref = /\.pdf$/i.test(href) ? href.split('/').pop() : '';
    var fromData = anchor.getAttribute('data-pdf') || '';
    var fromDownload = anchor.getAttribute('download') || '';
    if (fromDownload === 'true' || fromDownload === '') fromDownload = '';
    var base = fromData || fromDownload || fromHref || 'report.pdf';
    if (!/\.pdf$/i.test(base)) base += '.pdf';
    var name = (window.REPORT && REPORT.name) || '';
    var init = initials(name);
    if (init && /^[A-Za-z]+-/.test(base)) base = base.replace(/^[A-Za-z]+/, init);
    return base;
  }

  function isPdfLink(el) {
    if (!el || el.tagName !== 'A') return false;
    if (!el.closest || !el.closest('.bar')) return false;
    if (el.hasAttribute('data-pdf') || el.hasAttribute('data-pdf-name')) return true;
    if (el.hasAttribute('download') && /\.pdf/i.test((el.getAttribute('href') || '') + (el.getAttribute('download') || ''))) return true;
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return text === 'download pdf';
  }

  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function triggerDownload(blob, name) {
    var file = new File([blob], name, { type: 'application/pdf' });

    if (isIOS() && navigator.canShare) {
      try {
        if (navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file], title: name }).catch(function (err) {
            if (err && err.name === 'AbortError') return;
            fallbackAnchor(blob, name);
          });
        }
      } catch (e) { /* fall through */ }
    }

    fallbackAnchor(blob, name);
    return Promise.resolve();
  }

  function fallbackAnchor(blob, name) {
    var url = URL.createObjectURL(url);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 2500);
  }

  function setBusy(anchor, on, label) {
    anchor.classList.toggle('is-busy', on);
    if (on) {
      anchor.setAttribute('aria-busy', 'true');
      anchor.textContent = label || 'Preparing PDF…';
    } else {
      anchor.removeAttribute('aria-busy');
      anchor.textContent = 'Download PDF';
    }
  }

  function capture(anchor) {
    if (busy) return;
    busy = true;
    var original = anchor.textContent;
    setBusy(anchor, true, 'Preparing PDF…');

    var pages = Array.prototype.slice.call(document.querySelectorAll('.page'));
    if (!pages.length) {
      busy = false;
      setBusy(anchor, false);
      anchor.textContent = original;
      window.print();
      return;
    }

    var prevZ = document.documentElement.style.getPropertyValue('--z');
    document.body.classList.add('pdf-exporting');
    document.documentElement.style.setProperty('--z', '1');

    var scale = window.innerWidth < 500 ? 1.25 : (window.innerWidth < 800 ? 1.5 : 2);

    loadLibs()
      .then(function () { return document.fonts && document.fonts.ready; })
      .then(function () { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); })
      .then(function () {
        var jsPDF = window.jspdf && window.jspdf.jsPDF;
        if (!window.html2canvas || !jsPDF) throw new Error('PDF libraries failed to load');
        var pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
        var i = 0;

        function next() {
          if (i >= pages.length) return Promise.resolve(pdf);
          setBusy(anchor, true, 'Preparing PDF… ' + (i + 1) + '/' + pages.length);
          return window.html2canvas(pages[i], {
            scale: scale,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false,
            imageTimeout: 15000,
            windowWidth: pages[i].scrollWidth,
            windowHeight: pages[i].scrollHeight,
            onclone: function (doc) {
              var bar = doc.querySelector('.bar');
              if (bar) bar.style.display = 'none';
              doc.documentElement.style.setProperty('--z', '1');
              doc.body.classList.add('pdf-exporting');
              Array.prototype.forEach.call(doc.querySelectorAll('.page'), function (p) {
                p.style.zoom = '1';
                p.style.margin = '0';
                p.style.boxShadow = 'none';
              });
            }
          }).then(function (canvas) {
            var img = canvas.toDataURL('image/jpeg', 0.92);
            if (i > 0) pdf.addPage();
            pdf.addImage(img, 'JPEG', 0, 0, 210, 297, 'p' + i, 'FAST');
            canvas.width = 0;
            canvas.height = 0;
            i += 1;
            return next();
          });
        }

        return next();
      })
      .then(function (pdf) {
        var name = fileName(anchor);
        var blob = pdf.output('blob');
        return triggerDownload(blob, name);
      })
      .catch(function (err) {
        console.error(err);
        window.print();
      })
      .then(function () {
        document.body.classList.remove('pdf-exporting');
        if (prevZ) document.documentElement.style.setProperty('--z', prevZ);
        else document.documentElement.style.removeProperty('--z');
        setBusy(anchor, false);
        busy = false;
      });
  }

  document.addEventListener('click', function (ev) {
    var node = ev.target;
    while (node && node !== document && node.tagName !== 'A') node = node.parentNode;
    if (!isPdfLink(node)) return;
    ev.preventDefault();
    ev.stopPropagation();
    capture(node);
  }, true);
})();
