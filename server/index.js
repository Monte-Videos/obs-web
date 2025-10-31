import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { URL } from 'node:url'
import { connectOBS, isObsConnected } from './obsController.js'
import { startScheduler } from './scheduler.js'
import {
  listPlaylists,
  getPlaylist,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  replaceSchedules,
  getStateSnapshot,
  setStateSnapshot,
  resetSchedule
} from './store.js'

const port = Number(process.env.PORT || 8080)
const publicDir = join(process.cwd(), 'public')

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8'
}

function sendJson (res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  })
  res.end(JSON.stringify(payload))
}

function sendNoContent (res, statusCode = 204) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*'
  })
  res.end()
}

function handleCors (res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
}

async function readRequestBody (req) {
  return await new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => {
      data += chunk
      if (data.length > 5 * 1024 * 1024) {
        reject(new Error('Payload too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!data) return resolve(null)
      try {
        const parsed = JSON.parse(data)
        resolve(parsed)
      } catch (err) {
        reject(new Error('Invalid JSON payload'))
      }
    })
    req.on('error', reject)
  })
}

function validatePlaylistPayload (body) {
  const errors = []
  if (!body || typeof body !== 'object') {
    errors.push('Body must be an object')
    return { errors }
  }
  if (typeof body.name !== 'string' || body.name.trim() === '') {
    errors.push('Playlist name is required')
  }
  const description = typeof body.description === 'string' ? body.description : ''
  const actions = Array.isArray(body.actions) ? body.actions : []
  for (const [index, action] of actions.entries()) {
    if (!action || typeof action !== 'object') {
      errors.push(`Action at index ${index} must be an object`)
      continue
    }
    if (typeof action.requestType !== 'string' || action.requestType.trim() === '') {
      errors.push(`Action at index ${index} is missing requestType`)
    }
    if (action.requestData && typeof action.requestData !== 'object') {
      errors.push(`Action at index ${index} has invalid requestData`)
    }
  }
  if (errors.length > 0) return { errors }
  return {
    value: {
      name: body.name.trim(),
      description,
      actions: actions.map(action => ({
        requestType: action.requestType,
        requestData: action.requestData && typeof action.requestData === 'object' ? action.requestData : {}
      }))
    }
  }
}

function validateSchedulePayload (body) {
  const errors = []
  if (!body || typeof body !== 'object') {
    errors.push('Body must be an object')
    return { errors }
  }
  if (typeof body.playlistId !== 'string' || body.playlistId.trim() === '') {
    errors.push('playlistId is required')
  }
  if (typeof body.runAt !== 'string' || body.runAt.trim() === '') {
    errors.push('runAt is required')
  }
  const runAtDate = new Date(body.runAt)
  if (Number.isNaN(runAtDate.getTime())) {
    errors.push('runAt must be an ISO date string')
  }
  if (errors.length > 0) return { errors }
  return {
    value: {
      playlistId: body.playlistId.trim(),
      runAt: runAtDate.toISOString()
    }
  }
}

async function handleApi (req, res, url) {
  handleCors(res)
  if (req.method === 'OPTIONS') {
    sendNoContent(res, 204)
    return
  }

  const segments = url.pathname.split('/').filter(Boolean)

  if (url.pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      obsConnected: isObsConnected()
    })
    return
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    sendJson(res, 200, getStateSnapshot())
    return
  }

  if (url.pathname === '/api/state' && req.method === 'POST') {
    try {
      const body = await readRequestBody(req)
      sendJson(res, 200, setStateSnapshot(body || {}))
    } catch (err) {
      sendJson(res, 400, { error: err.message })
    }
    return
  }

  if (url.pathname === '/api/schedule' && req.method === 'GET') {
    sendJson(res, 200, listSchedules())
    return
  }

  if (url.pathname === '/api/schedule' && req.method === 'POST') {
    try {
      const body = await readRequestBody(req)
      const entries = Array.isArray(body) ? body : Array.isArray(body?.entries) ? body.entries : []
      const cleanEntries = []
      for (const entry of entries) {
        const result = validateSchedulePayload(entry)
        if (result.errors) {
          sendJson(res, 400, { errors: result.errors })
          return
        }
        if (!getPlaylist(result.value.playlistId)) {
          sendJson(res, 400, { errors: [`playlistId ${result.value.playlistId} does not exist`] })
          return
        }
        cleanEntries.push({
          ...result.value,
          id: typeof entry.id === 'string' ? entry.id : undefined
        })
      }
      sendJson(res, 200, replaceSchedules(cleanEntries))
    } catch (err) {
      sendJson(res, 400, { error: err.message })
    }
    return
  }

  if (segments[0] === 'api' && segments[1] === 'playlists') {
    const playlistId = segments[2]
    if (!playlistId) {
      if (req.method === 'GET') {
        sendJson(res, 200, listPlaylists())
        return
      }
      if (req.method === 'POST') {
        try {
          const body = await readRequestBody(req)
          const result = validatePlaylistPayload(body)
          if (result.errors) {
            sendJson(res, 400, { errors: result.errors })
            return
          }
          const playlist = createPlaylist(result.value)
          sendJson(res, 201, playlist)
        } catch (err) {
          sendJson(res, 400, { error: err.message })
        }
        return
      }
    } else {
      if (req.method === 'GET') {
        const playlist = getPlaylist(playlistId)
        if (!playlist) {
          sendJson(res, 404, { error: 'Playlist not found' })
          return
        }
        sendJson(res, 200, playlist)
        return
      }
      if (req.method === 'PUT') {
        try {
          const body = await readRequestBody(req)
          const result = validatePlaylistPayload(body)
          if (result.errors) {
            sendJson(res, 400, { errors: result.errors })
            return
          }
          const updated = updatePlaylist(playlistId, result.value)
          if (!updated) {
            sendJson(res, 404, { error: 'Playlist not found' })
            return
          }
          sendJson(res, 200, updated)
        } catch (err) {
          sendJson(res, 400, { error: err.message })
        }
        return
      }
      if (req.method === 'DELETE') {
        const removed = deletePlaylist(playlistId)
        if (!removed) {
          sendJson(res, 404, { error: 'Playlist not found' })
          return
        }
        sendNoContent(res, 204)
        return
      }
    }
  }

  if (segments[0] === 'api' && segments[1] === 'schedules') {
    const scheduleId = segments[2]
    if (!scheduleId) {
      if (req.method === 'GET') {
        sendJson(res, 200, listSchedules())
        return
      }
      if (req.method === 'POST') {
        try {
          const body = await readRequestBody(req)
          const result = validateSchedulePayload(body)
          if (result.errors) {
            sendJson(res, 400, { errors: result.errors })
            return
          }
          if (!getPlaylist(result.value.playlistId)) {
            sendJson(res, 400, { errors: ['playlistId does not exist'] })
            return
          }
          const schedule = createSchedule(result.value)
          sendJson(res, 201, schedule)
        } catch (err) {
          sendJson(res, 400, { error: err.message })
        }
        return
      }
    } else {
      if (req.method === 'GET') {
        const schedule = getSchedule(scheduleId)
        if (!schedule) {
          sendJson(res, 404, { error: 'Schedule not found' })
          return
        }
        sendJson(res, 200, schedule)
        return
      }
      if (req.method === 'PUT') {
        try {
          const body = await readRequestBody(req)
          const result = validateSchedulePayload(body)
          if (result.errors) {
            sendJson(res, 400, { errors: result.errors })
            return
          }
          if (!getPlaylist(result.value.playlistId)) {
            sendJson(res, 400, { errors: ['playlistId does not exist'] })
            return
          }
          const updated = updateSchedule(scheduleId, result.value)
          if (!updated) {
            sendJson(res, 404, { error: 'Schedule not found' })
            return
          }
          sendJson(res, 200, updated)
        } catch (err) {
          sendJson(res, 400, { error: err.message })
        }
        return
      }
      if (req.method === 'DELETE') {
        const removed = deleteSchedule(scheduleId)
        if (!removed) {
          sendJson(res, 404, { error: 'Schedule not found' })
          return
        }
        sendNoContent(res, 204)
        return
      }
      if (segments[3] === 'reset' && req.method === 'POST') {
        const updated = resetSchedule(scheduleId)
        if (!updated) {
          sendJson(res, 404, { error: 'Schedule not found' })
          return
        }
        sendJson(res, 200, updated)
        return
      }
    }
  }

  sendJson(res, 404, { error: 'Not found' })
}

async function serveStatic (res, pathname) {
  if (!existsSync(publicDir)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
    return
  }

  let requestedPath = pathname
  if (requestedPath.endsWith('/')) {
    requestedPath = `${requestedPath}index.html`
  }

  const safePath = normalize(requestedPath).replace(/^\/+/, '')
  let filePath = join(publicDir, safePath)

  if (!existsSync(filePath)) {
    filePath = join(publicDir, 'index.html')
  }

  try {
    const fileStat = await stat(filePath)
    if (fileStat.isDirectory()) {
      filePath = join(filePath, 'index.html')
    }
    const ext = extname(filePath)
    const type = mimeTypes[ext] || 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': type })
    createReadStream(filePath).pipe(res)
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url)
    return
  }
  await serveStatic(res, url.pathname)
})

server.listen(port, () => {
  console.log(`Server listening on http://0.0.0.0:${port}`)
  connectOBS().catch(() => {})
  startScheduler()
})
