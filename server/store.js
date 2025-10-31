import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const dataDir = join(process.cwd(), 'data')
const storePath = join(dataDir, 'scheduler.json')

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true })
}

const state = {
  playlists: [],
  schedules: []
}

if (existsSync(storePath)) {
  try {
    const raw = readFileSync(storePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      state.playlists = Array.isArray(parsed.playlists) ? parsed.playlists : []
      state.schedules = Array.isArray(parsed.schedules) ? parsed.schedules : []
    }
  } catch (err) {
    console.error('Failed to read scheduler state:', err)
  }
}

function persist () {
  const snapshot = JSON.stringify(state, null, 2)
  writeFileSync(storePath, snapshot)
}

function nowIso () {
  return new Date().toISOString()
}

function normaliseRunAt (value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function clonePlaylist (playlist) {
  if (!playlist) return null
  return {
    ...playlist,
    actions: Array.isArray(playlist.actions) ? playlist.actions.map(action => ({ ...action })) : []
  }
}

function cloneSchedule (schedule) {
  if (!schedule) return null
  return {
    ...schedule,
    firedAt: schedule.firedAt ?? null
  }
}

export function listPlaylists () {
  return state.playlists.map(clonePlaylist)
}

export function getPlaylist (id) {
  return clonePlaylist(state.playlists.find(item => item.id === id))
}

export function createPlaylist ({ name, description = '', actions = [] }) {
  const timestamp = nowIso()
  const playlist = {
    id: randomUUID(),
    name,
    description,
    actions,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  state.playlists.push(playlist)
  persist()
  return clonePlaylist(playlist)
}

export function updatePlaylist (id, { name, description = '', actions }) {
  const index = state.playlists.findIndex(item => item.id === id)
  if (index === -1) return null
  const playlist = state.playlists[index]
  if (typeof name === 'string') playlist.name = name
  if (typeof description === 'string') playlist.description = description
  if (Array.isArray(actions)) playlist.actions = actions
  playlist.updatedAt = nowIso()
  persist()
  return clonePlaylist(playlist)
}

export function deletePlaylist (id) {
  const before = state.playlists.length
  state.playlists = state.playlists.filter(item => item.id !== id)
  if (state.playlists.length === before) return false
  state.schedules = state.schedules.filter(item => item.playlistId !== id)
  persist()
  return true
}

export function listSchedules () {
  return state.schedules.map(cloneSchedule)
}

export function getSchedule (id) {
  return cloneSchedule(state.schedules.find(item => item.id === id))
}

export function createSchedule ({ playlistId, runAt }) {
  const timestamp = nowIso()
  const runAtIso = normaliseRunAt(runAt)
  if (!runAtIso) throw new Error('Invalid runAt value')
  const schedule = {
    id: randomUUID(),
    playlistId,
    runAt: runAtIso,
    firedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  state.schedules.push(schedule)
  persist()
  return cloneSchedule(schedule)
}

export function updateSchedule (id, { playlistId, runAt, firedAt = undefined }) {
  const index = state.schedules.findIndex(item => item.id === id)
  if (index === -1) return null
  const schedule = state.schedules[index]
  if (typeof playlistId === 'string') schedule.playlistId = playlistId
  if (typeof runAt === 'string') {
    const runAtIso = normaliseRunAt(runAt)
    if (!runAtIso) throw new Error('Invalid runAt value')
    schedule.runAt = runAtIso
    schedule.firedAt = null
  }
  if (firedAt === null) schedule.firedAt = null
  if (typeof firedAt === 'string') schedule.firedAt = firedAt
  schedule.updatedAt = nowIso()
  persist()
  return cloneSchedule(schedule)
}

export function deleteSchedule (id) {
  const before = state.schedules.length
  state.schedules = state.schedules.filter(item => item.id !== id)
  if (state.schedules.length === before) return false
  persist()
  return true
}

export function replaceSchedules (schedules) {
  const timestamp = nowIso()
  const playlistIds = new Set(state.playlists.map(item => item.id))
  state.schedules = schedules
    .filter(item => playlistIds.has(item.playlistId))
    .map(item => {
      const runAtIso = normaliseRunAt(item.runAt)
      if (!runAtIso) return null
      return {
        id: typeof item.id === 'string' ? item.id : randomUUID(),
        playlistId: item.playlistId,
        runAt: runAtIso,
        firedAt: item.firedAt ?? null,
        createdAt: item.createdAt ?? timestamp,
        updatedAt: timestamp
      }
    })
    .filter(Boolean)
  persist()
  return listSchedules()
}

export function findDueSchedules (now) {
  const nowMs = now.getTime()
  return state.schedules
    .filter(item => !item.firedAt && new Date(item.runAt).getTime() <= nowMs)
    .map(cloneSchedule)
}

export function markScheduleFired (id, firedAt) {
  const index = state.schedules.findIndex(item => item.id === id)
  if (index === -1) return null
  const iso = firedAt instanceof Date ? firedAt.toISOString() : firedAt
  state.schedules[index].firedAt = iso
  state.schedules[index].updatedAt = nowIso()
  persist()
  return cloneSchedule(state.schedules[index])
}

export function resetSchedule (id) {
  const index = state.schedules.findIndex(item => item.id === id)
  if (index === -1) return null
  state.schedules[index].firedAt = null
  state.schedules[index].updatedAt = nowIso()
  persist()
  return cloneSchedule(state.schedules[index])
}

export function getStateSnapshot () {
  return {
    playlists: listPlaylists(),
    schedules: listSchedules()
  }
}

export function setStateSnapshot ({ playlists = [], schedules = [] }) {
  state.playlists = playlists.map(item => ({
    id: typeof item.id === 'string' ? item.id : randomUUID(),
    name: item.name,
    description: item.description ?? '',
    actions: Array.isArray(item.actions) ? item.actions : [],
    createdAt: item.createdAt ?? nowIso(),
    updatedAt: nowIso()
  }))
  const playlistIds = new Set(state.playlists.map(item => item.id))
  state.schedules = schedules
    .filter(item => playlistIds.has(item.playlistId))
    .map(item => {
      const runAtIso = normaliseRunAt(item.runAt)
      if (!runAtIso) return null
      return {
        id: typeof item.id === 'string' ? item.id : randomUUID(),
        playlistId: item.playlistId,
        runAt: runAtIso,
        firedAt: item.firedAt ?? null,
        createdAt: item.createdAt ?? nowIso(),
        updatedAt: nowIso()
      }
    })
    .filter(Boolean)
  persist()
  return getStateSnapshot()
}
