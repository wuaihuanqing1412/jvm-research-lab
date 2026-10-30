import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', 'lab')
const port = Number(process.env.PORT || 5193)

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.class': 'application/java-vm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.bin': 'application/octet-stream',
}

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
    const file = path.resolve(root, rel)
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end('forbidden')
      return
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
        return
      }
      res.writeHead(200, {
        'content-type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      })
      res.end(data)
    })
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`JVM Research Lab: http://127.0.0.1:${port}/`)
  })
