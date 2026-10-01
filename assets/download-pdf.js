/* Client-side PDF packager.
   Uses the browser's own renderer (not html2canvas's fake paint) at ~300dpi
   so the file matches what you see on screen. */
(function () {
  var LIBS = [
    'https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.js',
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js'
  ];
  var FALLBACK = 'https://cdn.jsdelivr.net/npm/html2canvas-pro@1.5.13/dist/html2canvas-pro.min.js';
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

  function loadLibs(list) {
    var chain = Promise.resolve();
    list.forEach(function (src) {
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

  function isMobile() {
    return window.innerWidth < 700 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '');
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
    var url = URL.createObjectURL(blob);
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

  function pageBackground(page) {
    var bg = getComputedStyle(page).backgroundColor;
    if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return '#ffffff';
    return bg;
  }

  function snapWithHtmlToImage(page, ratio) {
    return window.htmlToImage.toCanvas(page, {
      pixelRatio: ratio,
      cacheBust: false,
      backgroundColor: pageBackground(page),
      skipAutoScale: true,
      width: page.offsetWidth,
      height: page.offsetHeight,
      style: {
        zoom: '1',
        margin: '0',
        boxShadow: 'none',
        transform: 'none'
      }
    });
  }

  function snapWithHtml2Canvas(page, ratio) {
    return window.html2canvas(page, {
      scale: ratio,
      useCORS: true,
      backgroundColor: pageBackground(page),
      logging: false,
      letterRendering: true,
      foreignObjectRendering: true,
      imageTimeout: 20000,
      windowWidth: page.scrollWidth,
      windowHeight: page.scrollHeight,
      onclone: function (doc) {
        var bar = doc.querySelector('.bar');
        if (bar) bar.style.display = 'none';
        doc.documentElement.style.setProperty('--z', '1');
        Array.prototype.forEach.call(doc.querySelectorAll('.page'), function (p) {
          p.style.zoom = '1';
          p.style.margin = '0';
          p.style.boxShadow = 'none';
        });
      }
    });
  }

  function canvasToImage(canvas, png) {
    if (png) {
      try {
        var data = canvas.toDataURL('image/png');
        if (data && data.length > 32) return { data: data, format: 'PNG' };
      } catch (e) { /* fall through */ }
    }
    return { data: canvas.toDataURL('image/jpeg', 0.98), format: 'JPEG' };
  }

  function capturePage(page, ratio) {
    var run = window.htmlToImage
      ? snapWithHtmlToImage(page, ratio)
      : Promise.reject(new Error('html-to-image missing'));
    return run.catch(function () {
      if (window.html2canvas) return snapWithHtml2Canvas(page, ratio);
      return loadScript(FALLBACK).then(function () { return snapWithHtml2Canvas(page, ratio); });
    });
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

    var mobile = isMobile();
    var ratio = mobile ? 2.5 : 3;
    var preferPng = !mobile;

    loadLibs(LIBS)
      .then(function () { return document.fonts && document.fonts.ready; })
      .then(function () {
        return new Promise(function (r) {
          requestAnimationFrame(function () { requestAnimationFrame(r); });
        });
      })
      .then(function () {
        var jsPDF = window.jspdf && window.jspdf.jsPDF;
        if (!jsPDF) throw new Error('jsPDF failed to load');
        if (!window.htmlToImage && !window.html2canvas) throw new Error('renderer failed to load');

        var pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: 'a4',
          compress: true,
          hotfixes: ['px_scaling']
        });
        var i = 0;

        function next() {
          if (i >= pages.length) return Promise.resolve(pdf);
          setBusy(anchor, true, 'Rendering page ' + (i + 1) + ' of ' + pages.length + '…');
          return capturePage(pages[i], ratio).then(function (canvas) {
            var img = canvasToImage(canvas, preferPng);
            if (i > 0) pdf.addPage();
            pdf.addImage(img.data, img.format, 0, 0, 210, 297, 'p' + i, 'NONE');
            canvas.width = 0;
            canvas.height = 0;
            i += 1;
            return next();
          });
        }

        return next();
      })
      .then(function (pdf) {
        setBusy(anchor, true, 'Saving PDF…');
        return triggerDownload(pdf.output('blob'), fileName(anchor));
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
