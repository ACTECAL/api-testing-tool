// curl command → a request the browser can send with fetch(). Handles bash quoting ('…', "…", $'…'),
// line continuations, Chrome's "Copy as cURL" (bash and cmd), and the common options. Options a browser
// cannot honour are reported in `notes`. Pure; covered by test/curl.test.js.
// Copied from actecal-website/src/lib/curl.js (the web curl tester); keep the two in step.
function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// Headers that fetch() is not allowed to set (Fetch standard, "forbidden request-header"); the browser
// drops them or sets them itself. Names starting with Sec- or Proxy- are forbidden too.
export const FORBIDDEN_HEADERS = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
]);

export function isForbiddenHeader(name) {
  const lower = String(name).toLowerCase();
  return FORBIDDEN_HEADERS.has(lower) || lower.startsWith('sec-') || lower.startsWith('proxy-');
}

// fetch() throws for these methods.
export const FORBIDDEN_METHODS = new Set(['CONNECT', 'TRACE', 'TRACK']);

const NO_VALUE = new Set([
  '-s', '--silent', '-S', '--show-error', '-v', '--verbose', '-i', '--include', '-L', '--location', '-k', '--insecure',
  '--compressed', '-g', '--globoff', '--http1.1', '--http2', '--http2-prior-knowledge', '-N', '--no-buffer', '-f', '--fail',
  '-#', '--progress-bar', '-I', '--head', '-G', '--get', '-n', '--netrc',
]);
const WITH_VALUE = {
  '-X': 'request', '--request': 'request',
  '-H': 'header', '--header': 'header',
  '-d': 'data', '--data': 'data', '--data-ascii': 'data', '--data-binary': 'binary', '--data-raw': 'raw',
  '--data-urlencode': 'urlencode',
  '--json': 'json',
  '-F': 'form', '--form': 'form', '--form-string': 'formString',
  '-u': 'user', '--user': 'user',
  '-A': 'agent', '--user-agent': 'agent',
  '-b': 'cookie', '--cookie': 'cookie',
  '-e': 'referer', '--referer': 'referer',
  '-m': 'timeout', '--max-time': 'timeout',
  '--url': 'url',
  '--oauth2-bearer': 'bearer',
  '-o': 'ignore', '--output': 'ignore', '--connect-timeout': 'ignore', '--retry': 'ignore', '-w': 'ignore', '--write-out': 'ignore',
  '-x': 'proxy', '--proxy': 'proxy', '--cacert': 'ignore', '--cert': 'cert', '-E': 'cert', '--key': 'cert', '--resolve': 'ignore',
};
const SHORT_WITH_VALUE = new Set(['X', 'H', 'd', 'F', 'u', 'A', 'b', 'e', 'm', 'o', 'x', 'E', 'w']);

export class CurlError extends Error {}

// Windows cmd quoting from Chrome's "Copy as cURL (cmd)": ^" → ", ^^ → ^, and ^ at line ends.
function fromCmd(command) {
  if (!/\^"/.test(command)) return command;
  return command
    .replace(/\^\r?\n/g, ' ')
    .replace(/\^(.)/g, '$1');
}

const ESCAPES = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', e: '\x1b', f: '\f', v: '\v' };

/** Splits a shell command into words, following bash quoting rules for the common cases. */
export function tokenize(command) {
  const source = fromCmd(String(command ?? '')).replace(/\\\r?\n/g, ' ');
  const words = [];
  let word = '';
  let inWord = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      if (inWord) {
        words.push(word);
        word = '';
        inWord = false;
      }
    } else if (ch === "'") {
      const end = source.indexOf("'", i + 1);
      if (end < 0) throw new CurlError('A single quote is not closed.');
      word += source.slice(i + 1, end);
      i = end;
      inWord = true;
    } else if (ch === '$' && source[i + 1] === "'") {
      i += 2;
      for (; i < source.length && source[i] !== "'"; i += 1) {
        if (source[i] === '\\' && i + 1 < source.length) {
          const next = source[i + 1];
          if (next === 'x' && /^[0-9a-fA-F]{2}$/.test(source.slice(i + 2, i + 4))) {
            word += String.fromCharCode(parseInt(source.slice(i + 2, i + 4), 16));
            i += 3;
          } else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(source.slice(i + 2, i + 6))) {
            word += String.fromCharCode(parseInt(source.slice(i + 2, i + 6), 16));
            i += 5;
          } else {
            word += ESCAPES[next] ?? next;
            i += 1;
          }
        } else {
          word += source[i];
        }
      }
      if (i >= source.length) throw new CurlError("A $'…' string is not closed.");
      inWord = true;
    } else if (ch === '"') {
      i += 1;
      for (; i < source.length && source[i] !== '"'; i += 1) {
        if (source[i] === '\\' && '"\\$`'.includes(source[i + 1])) {
          word += source[i + 1];
          i += 1;
        } else {
          word += source[i];
        }
      }
      if (i >= source.length) throw new CurlError('A double quote is not closed.');
      inWord = true;
    } else if (ch === '\\' && i + 1 < source.length) {
      word += source[i + 1];
      i += 1;
      inWord = true;
    } else {
      word += ch;
      inWord = true;
    }
  }
  if (inWord) words.push(word);
  return words;
}

function encodeFormValue(value) {
  // --data-urlencode forms: "content", "=content", "name=content", "name@file".
  const eq = value.indexOf('=');
  if (eq === 0) return encodeURIComponent(value.slice(1));
  if (eq > 0) return `${value.slice(0, eq)}=${encodeURIComponent(value.slice(eq + 1))}`;
  return encodeURIComponent(value);
}

const baseName = (path) => String(path).split(/[\\/]/).pop() || 'file';

// -F "name=@path;type=image/png;filename=photo.png" or "name=<path" → { fileName, contentType, asText }.
function formFile(spec) {
  const asText = spec.startsWith('<');
  const [path, ...params] = spec.slice(1).split(';');
  const param = (key) => params.map((item) => item.trim()).find((item) => item.toLowerCase().startsWith(`${key}=`))?.slice(key.length + 1).replace(/^"|"$/g, '');
  return { fileName: param('filename') || baseName(path.replace(/^"|"$/g, '')), contentType: param('type') || null, asText };
}

/**
 * → { method, url, headers: [[name, value]], body, form, bodyFile, timeoutSeconds, notes }
 * body is a string or null. form is null, or the -F fields (multipart) as [name, value] for text and
 * [name, '', { fileName, contentType, asText }] for files, which the visitor then chooses. bodyFile is
 * { fileName } when the body comes from a file (-d @file, --data-binary @file), else null.
 */
export function parseCurl(command) {
  const words = tokenize(command);
  if (!words.length) throw new CurlError('Paste a curl command.');
  if (/^curl(\.exe)?$/i.test(words[0])) words.shift();
  const request = { method: null, url: null, headers: [], data: [], form: null, bodyFile: null, json: false, timeoutSeconds: null, head: false, get: false, notes: [] };
  const note = (text) => {
    if (!request.notes.includes(text)) request.notes.push(text);
  };

  const apply = (option, value) => {
    switch (option) {
      case 'request':
        request.method = value.toUpperCase();
        break;
      case 'header': {
        const colon = value.indexOf(':');
        if (colon > 0) {
          const name = value.slice(0, colon).trim();
          const headerValue = value.slice(colon + 1).trim();
          if (headerValue || !value.endsWith(':')) request.headers.push([name, headerValue]);
        }
        break;
      }
      case 'data':
      case 'binary':
        if (value === '@-') note('Data from standard input (@-) cannot be read here; paste the content instead.');
        else if (value.startsWith('@')) {
          request.bodyFile = { fileName: baseName(value.slice(1).replace(/^"|"$/g, '')) };
          note(`Choose the file ${request.bodyFile.fileName} to send as the body.`);
          if (option === 'data') note('curl -d @file removes line breaks from the file; this tester sends the file exactly as it is (like --data-binary).');
        } else request.data.push(value);
        break;
      case 'raw':
        request.data.push(value);
        break;
      case 'urlencode':
        request.data.push(encodeFormValue(value));
        break;
      case 'json':
        request.json = true;
        request.data.push(value);
        break;
      case 'form':
      case 'formString': {
        request.form ||= [];
        const eq = value.indexOf('=');
        const name = eq > 0 ? value.slice(0, eq) : value;
        const fieldValue = eq > 0 ? value.slice(eq + 1) : '';
        if (option === 'form' && (fieldValue.startsWith('@') || fieldValue.startsWith('<'))) {
          const file = formFile(fieldValue);
          note(`Choose the file ${file.fileName} for the form field "${name}".`);
          request.form.push([name, '', file]);
        } else {
          request.form.push([name, fieldValue]);
        }
        break;
      }
      case 'user': {
        const bytes = new TextEncoder().encode(value.includes(':') ? value : `${value}:`);
        request.headers.push(['Authorization', `Basic ${bytesToBase64(bytes)}`]);
        break;
      }
      case 'bearer':
        request.headers.push(['Authorization', `Bearer ${value}`]);
        break;
      case 'agent':
        request.headers.push(['User-Agent', value]);
        break;
      case 'cookie':
        request.headers.push(['Cookie', value]);
        break;
      case 'referer':
        request.headers.push(['Referer', value]);
        break;
      case 'timeout':
        request.timeoutSeconds = Number(value) || null;
        break;
      case 'url':
        request.url = value;
        break;
      case 'proxy':
        // The desktop app can use a proxy (the web tester cannot).
        request.proxy = value;
        break;
      case 'cert':
        note('Client certificates are not supported yet.');
        break;
      default:
        break;
    }
  };

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (word.startsWith('--') && word.includes('=') && WITH_VALUE[word.slice(0, word.indexOf('='))]) {
      apply(WITH_VALUE[word.slice(0, word.indexOf('='))], word.slice(word.indexOf('=') + 1));
    } else if (WITH_VALUE[word]) {
      if (i + 1 >= words.length) throw new CurlError(`${word} needs a value.`);
      apply(WITH_VALUE[word], words[i + 1]);
      i += 1;
    } else if (NO_VALUE.has(word)) {
      if (word === '-I' || word === '--head') request.head = true;
      else if (word === '-G' || word === '--get') request.get = true;
      else if (word === '-k' || word === '--insecure') request.insecure = true;
    } else if (/^-[a-zA-Z#]{2,}$/.test(word) || (/^-[a-zA-Z]/.test(word) && SHORT_WITH_VALUE.has(word[1]) && word.length > 2)) {
      // Combined short options (-sSL, -sSX POST) or an attached value (-XPOST, -H'Accept: */*').
      for (let k = 1; k < word.length; k += 1) {
        const flag = `-${word[k]}`;
        if (SHORT_WITH_VALUE.has(word[k])) {
          const attached = word.slice(k + 1);
          if (attached) apply(WITH_VALUE[flag], attached);
          else {
            if (i + 1 >= words.length) throw new CurlError(`${flag} needs a value.`);
            apply(WITH_VALUE[flag], words[i + 1]);
            i += 1;
          }
          break;
        }
        if (flag === '-I') request.head = true;
        if (flag === '-G') request.get = true;
        if (flag === '-k') request.insecure = true;
      }
    } else if (word.startsWith('-') && word.length > 1) {
      note(`The option ${word} is not supported and was ignored.`);
    } else if (!request.url) {
      request.url = word;
    } else {
      note(`Extra URL "${word}" was ignored; only the first is sent.`);
    }
  }

  if (!request.url) throw new CurlError('The command has no URL.');
  let url = request.url;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new CurlError(`"${request.url}" is not a valid URL.`);
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new CurlError('Only http and https URLs can be tested here.');

  let body = request.data.length ? request.data.join('&') : null;
  if (request.get && body !== null) {
    parsedUrl.search = parsedUrl.search ? `${parsedUrl.search}&${body}` : `?${body}`;
    body = null;
  }
  if (request.form && request.bodyFile) {
    note('Both a body file and -F were given; only the -F form fields are sent.');
    request.bodyFile = null;
  }
  if (request.bodyFile && body !== null) {
    note('Both data and a body file were given; only the file is sent.');
    body = null;
  }
  const hasHeader = (name) => request.headers.some(([key]) => key.toLowerCase() === name);
  if (request.json) {
    if (!hasHeader('content-type')) request.headers.push(['Content-Type', 'application/json']);
    if (!hasHeader('accept')) request.headers.push(['Accept', 'application/json']);
  } else if ((body !== null || request.bodyFile) && !hasHeader('content-type')) {
    // curl's default for -d and --data-binary, files included.
    request.headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
  }
  if (request.form && body !== null) note('Both -d and -F were given; only the -F form fields are sent.');
  if (request.form && hasHeader('content-type')) {
    // A multipart body needs the boundary that the browser generates, so a fixed Content-Type would break it.
    request.headers = request.headers.filter(([key]) => key.toLowerCase() !== 'content-type');
    note('The Content-Type header was removed: the browser sets multipart/form-data with its own boundary for -F fields.');
  }

  let method = request.method || (request.head ? 'HEAD' : body !== null || request.form || request.bodyFile ? 'POST' : 'GET');
  if (request.get) method = request.method || 'GET';
  if (FORBIDDEN_METHODS.has(method)) note(`Browsers cannot send ${method} requests.`);

  const blocked = [...new Set(request.headers.map(([name]) => name).filter(isForbiddenHeader))];
  if (blocked.length === 1) note(`Browsers set the ${blocked[0]} header themselves, so it is not sent.`);
  if (blocked.length > 1) note(`Browsers set these headers themselves, so they are not sent: ${blocked.join(', ')}.`);
  if (blocked.some((name) => name.toLowerCase() === 'cookie')) note('Cookies are never sent from this page. If the API needs a session, send its token in an Authorization header.');

  return {
    method,
    url: parsedUrl.href,
    headers: request.headers,
    body: request.form || request.bodyFile ? null : body,
    form: request.form,
    bodyFile: request.bodyFile,
    timeoutSeconds: request.timeoutSeconds,
    proxy: request.proxy || null,
    insecure: Boolean(request.insecure),
    notes: request.notes,
  };
}

// CORS: a "simple" request goes straight out; anything else is preceded by an OPTIONS preflight that the
// API must approve. https://fetch.spec.whatwg.org/#cors-safelisted-request-header
const SIMPLE_METHODS = new Set(['GET', 'HEAD', 'POST']);
const SAFELISTED_HEADERS = new Set(['accept', 'accept-language', 'content-language', 'content-type', 'range']);
const SIMPLE_CONTENT_TYPES = new Set(['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']);

/** Why the browser will send an OPTIONS preflight first; an empty list means it will not. */
export function preflightReasons(request) {
  const reasons = [];
  if (!SIMPLE_METHODS.has(request.method)) reasons.push(`the ${request.method} method`);
  request.headers.forEach(([name, value]) => {
    const lower = name.toLowerCase();
    if (isForbiddenHeader(lower)) return;
    if (!SAFELISTED_HEADERS.has(lower)) {
      reasons.push(`the ${name} header`);
    } else if (lower === 'content-type') {
      const essence = String(value).split(';')[0].trim().toLowerCase();
      if (!SIMPLE_CONTENT_TYPES.has(essence)) reasons.push(`Content-Type ${essence || '(empty)'}`);
    }
  });
  return [...new Set(reasons)];
}

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** "Name: value" lines → { headers, errors, notes }. Blank lines and lines starting with # are skipped. */
export function parseHeaderLines(text) {
  const headers = [];
  const errors = [];
  const notes = [];
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      if (trimmed.startsWith(':')) {
        notes.push(`Line ${index + 1}: HTTP/2 pseudo-headers such as ${trimmed.split(/\s/)[0]} are set by the browser, so it was skipped.`);
        return;
      }
      const colon = trimmed.indexOf(':');
      if (colon <= 0) {
        errors.push(`Line ${index + 1}: write each header as "Name: value".`);
        return;
      }
      const name = trimmed.slice(0, colon).trim();
      const value = trimmed.slice(colon + 1).trim();
      // fetch() accepts header values made of bytes only: no characters beyond U+00FF and no line breaks.
      if (!HEADER_NAME.test(name)) errors.push(`Line ${index + 1}: "${name}" is not a valid header name.`);
      else if (/[^\t\x20-\xff]/.test(value)) errors.push(`Line ${index + 1}: the value of ${name} has characters a header cannot carry; URL-encode them first.`);
      else headers.push([name, value]);
    });
  return { headers, errors, notes };
}

const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

/**
 * A curl command for the request, one option per line. Form files ([name, '', { fileName, contentType,
 * asText }]) become -F name=@file, and request.bodyFile ({ fileName }) becomes --data-binary @file.
 */
export function toCurl(request) {
  const hasBody = Boolean(request.form) || Boolean(request.bodyFile) || (request.body !== null && request.body !== undefined && request.body !== '');
  const parts = [`curl ${shellQuote(request.url)}`];
  // curl picks GET, or POST when there is data, by itself; -X HEAD would make it wait for a body, so -I.
  if (request.method === 'HEAD') parts.push('-I');
  else if (!(request.method === 'GET' && !hasBody) && !(request.method === 'POST' && hasBody)) parts.push(`-X ${request.method}`);
  request.headers.forEach(([name, value]) => parts.push(`-H ${shellQuote(`${name}: ${value}`)}`));
  if (request.form) {
    request.form.forEach(([name, value, file]) => {
      if (!file) parts.push(`--form-string ${shellQuote(`${name}=${value}`)}`);
      else parts.push(`-F ${shellQuote(`${name}=${file.asText ? '<' : '@'}${file.fileName}${!file.asText && file.contentType ? `;type=${file.contentType}` : ''}`)}`);
    });
  } else if (request.bodyFile) parts.push(`--data-binary ${shellQuote(`@${request.bodyFile.fileName}`)}`);
  else if (hasBody) parts.push(`--data-raw ${shellQuote(request.body)}`);
  return parts.join(' \\\n  ');
}

const quote = (value) => JSON.stringify(value);

/** Equivalent JavaScript fetch() code. */
export function toFetchCode(request) {
  const headers = request.headers.filter(([name]) => !isForbiddenHeader(name));
  const lines = [];
  let inputs = 0;
  const fileInput = (fileName) => {
    inputs += 1;
    return { expression: `fileInput${inputs}.files[0]`, comment: `// fileInput${inputs}: an <input type="file"> holding ${fileName}` };
  };
  if (request.form) {
    lines.push('const form = new FormData();');
    request.form.forEach(([name, value, file]) => {
      if (!file) {
        lines.push(`form.append(${quote(name)}, ${quote(value)});`);
        return;
      }
      const input = fileInput(file.fileName);
      lines.push(file.asText ? `form.append(${quote(name)}, await ${input.expression}.text()); ${input.comment}` : `form.append(${quote(name)}, ${input.expression}, ${quote(file.fileName)}); ${input.comment}`);
    });
    lines.push('');
  }
  lines.push(`const response = await fetch(${quote(request.url)}, {`);
  lines.push(`  method: ${quote(request.method)},`);
  if (headers.length) {
    lines.push('  headers: {');
    headers.forEach(([name, value]) => lines.push(`    ${quote(name)}: ${quote(value)},`));
    lines.push('  },');
  }
  if (request.form) lines.push('  body: form,');
  else if (request.bodyFile) {
    const input = fileInput(request.bodyFile.fileName);
    lines.push(`  body: ${input.expression}, ${input.comment}`);
  } else if (request.body !== null && request.body !== undefined) lines.push(`  body: ${quote(request.body)},`);
  lines.push('});');
  lines.push('const data = await response.text();');
  return lines.join('\n');
}
