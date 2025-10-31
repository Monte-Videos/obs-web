import OBSWebSocket from 'obs-websocket-js'

const obs = new OBSWebSocket()
let connectionState = 'idle'
let reconnectTimeout

function connectionUrl () {
  if (process.env.OBS_URL) return process.env.OBS_URL
  const host = process.env.OBS_HOST || '127.0.0.1'
  const port = process.env.OBS_PORT || '4455'
  const protocol = process.env.OBS_USE_SSL === 'true' ? 'wss' : 'ws'
  return `${protocol}://${host}:${port}`
}

function scheduleReconnect () {
  if (reconnectTimeout) return
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null
    connectOBS().catch(() => {})
  }, 5000)
}

export async function connectOBS () {
  const url = connectionUrl()
  const password = process.env.OBS_PASSWORD || ''
  try {
    connectionState = 'connecting'
    await obs.connect(url, password)
    connectionState = 'connected'
    console.log(`Connected to OBS at ${url}`)
  } catch (err) {
    connectionState = 'disconnected'
    console.error('Failed to connect to OBS:', err.message)
    scheduleReconnect()
    throw err
  }
}

obs.on('ConnectionClosed', () => {
  connectionState = 'disconnected'
  console.warn('OBS connection closed')
  scheduleReconnect()
})

obs.on('ConnectionError', err => {
  connectionState = 'disconnected'
  console.error('OBS connection error:', err.message)
  scheduleReconnect()
})

obs.on('Identified', () => {
  connectionState = 'connected'
})

export function isObsConnected () {
  return connectionState === 'connected'
}

export async function playPlaylist (playlist) {
  if (!playlist) {
    throw new Error('Playlist not found')
  }
  if (!Array.isArray(playlist.actions) || playlist.actions.length === 0) {
    console.warn(`Playlist ${playlist.id} has no actions configured`)
    return
  }
  for (const action of playlist.actions) {
    const requestType = action?.requestType
    if (!requestType) {
      console.warn(`Skipping action without requestType in playlist ${playlist.id}`)
      continue
    }
    const requestData = action.requestData && typeof action.requestData === 'object' ? action.requestData : {}
    try {
      await obs.call(requestType, requestData)
    } catch (err) {
      console.error(`Failed to execute ${requestType} for playlist ${playlist.id}:`, err.message)
      throw err
    }
  }
}
