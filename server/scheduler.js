import { findDueSchedules, markScheduleFired, getPlaylist } from './store.js'
import { playPlaylist } from './obsController.js'

let intervalHandle
let isRunning = false

async function tick () {
  if (isRunning) return
  isRunning = true
  try {
    const due = findDueSchedules(new Date())
    for (const schedule of due) {
      const playlist = getPlaylist(schedule.playlistId)
      if (!playlist) {
        console.warn(`Skipping schedule ${schedule.id} because playlist ${schedule.playlistId} does not exist`)
        markScheduleFired(schedule.id, new Date())
        continue
      }
      try {
        console.log(`Running scheduled playlist ${playlist.name} (${playlist.id}) from schedule ${schedule.id}`)
        await playPlaylist(playlist)
        markScheduleFired(schedule.id, new Date())
      } catch (err) {
        console.error(`Failed to run schedule ${schedule.id}:`, err.message)
      }
    }
  } finally {
    isRunning = false
  }
}

export function startScheduler ({ intervalMs = 5000 } = {}) {
  if (intervalHandle) clearInterval(intervalHandle)
  intervalHandle = setInterval(() => {
    tick().catch(err => {
      console.error('Scheduler tick error:', err)
    })
  }, intervalMs)
  tick().catch(err => {
    console.error('Initial scheduler run failed:', err)
  })
}

export function stopScheduler () {
  if (intervalHandle) clearInterval(intervalHandle)
  intervalHandle = null
}
