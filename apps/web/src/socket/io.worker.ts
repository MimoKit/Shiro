/// <reference lib="webworker" />

interface SocketWorkerConfig {
  url: string
  socket_session_id: string
  lang?: string
}

let ws: WebSocket | null = null
let currentConfig: SocketWorkerConfig | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let isExplicitClose = false

const ports = [] as MessagePort[]
const waitingEmitQueue: any[] = []

function resolveWsUrl(
  rawUrl: string,
  sessionId?: string,
  lang?: string,
): string {
  let wsUrl = (rawUrl || '').trim()
  if (!wsUrl && typeof self !== 'undefined' && 'location' in self) {
    wsUrl = self.location.origin
  }
  if (!wsUrl) {
    wsUrl = 'https://blog.xlinxc.cn'
  }

  // Convert http/https to ws/wss
  wsUrl = wsUrl
    .replace(/^http:/i, 'ws:')
    .replace(/^https:/i, 'wss:')
    .replace(/\/$/, '')

  // Target endpoint is /ws/web for Mix Space Core v14+
  if (wsUrl.endsWith('/ws/web')) {
    // already ends with /ws/web
  } else if (wsUrl.endsWith('/ws')) {
    wsUrl += '/web'
  } else if (wsUrl.endsWith('/web')) {
    if (!wsUrl.endsWith('/ws/web')) {
      wsUrl = `${wsUrl.slice(0, -4)  }/ws/web`
    }
  } else {
    wsUrl += '/ws/web'
  }

  try {
    const urlObj = new URL(wsUrl)
    if (sessionId) {
      urlObj.searchParams.set('socket_session_id', sessionId)
    }
    if (lang) {
      urlObj.searchParams.set('lang', lang)
    }
    return urlObj.toString()
  } catch {
    const queryParts: string[] = []
    if (sessionId)
      queryParts.push(`socket_session_id=${encodeURIComponent(sessionId)}`)
    if (lang) queryParts.push(`lang=${encodeURIComponent(lang)}`)
    return `${wsUrl}${queryParts.length ? `?${queryParts.join('&')}` : ''}`
  }
}

function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ v: 1, event: 'ping', id: String(Date.now()) }))
      } catch {}
    }
  }, 25000)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

function boardcast(payload: any) {
  ports.forEach((port) => {
    try {
      port.postMessage(payload)
    } catch (e) {
      console.error('[ws worker] broadcast error:', e)
    }
  })
}

function sendPayload(payload: any) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    waitingEmitQueue.push(payload)
    return
  }

  let formattedMessage: string | null = null

  const { type, payload: innerPayload } = payload || {}
  switch (type) {
  case 'updateSid': {
    formattedMessage = JSON.stringify({
      v: 1,
      event: 'session.update',
      payload: { sessionId: innerPayload?.sessionId || innerPayload?.sid },
    })
  
  break;
  }
  case 'updateLang': {
    formattedMessage = JSON.stringify({
      v: 1,
      event: 'lang.update',
      payload: { lang: innerPayload?.lang },
    })
  
  break;
  }
  case 'join': {
    formattedMessage = JSON.stringify({
      v: 1,
      event: 'room.join',
      payload: { room: innerPayload?.room },
    })
  
  break;
  }
  case 'leave': {
    formattedMessage = JSON.stringify({
      v: 1,
      event: 'room.leave',
      payload: { room: innerPayload?.room },
    })
  
  break;
  }
  default: if (payload?.event) {
    formattedMessage = JSON.stringify(payload)
  } else {
    formattedMessage = JSON.stringify({
      v: 1,
      event: type || 'message',
      payload: innerPayload ?? payload,
    })
  }
  }

  if (formattedMessage) {
    ws.send(formattedMessage)
  }
}

function setupWs(config: SocketWorkerConfig) {
  currentConfig = config
  if (ws) {
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    ) {
      return
    }
    try {
      ws.close()
    } catch {}
    ws = null
  }

  const finalUrl = resolveWsUrl(
    config.url,
    config.socket_session_id,
    config.lang,
  )
  console.info('[ws worker] Connecting to Native WebSocket:', finalUrl)

  isExplicitClose = false
  try {
    ws = new WebSocket(finalUrl)
  } catch (err) {
    console.error('[ws worker] Failed to create WebSocket:', err)
    scheduleReconnect()
    return
  }

  ws.onopen = () => {
    console.info('[ws worker] WebSocket connection open')
    startHeartbeat()

    while (waitingEmitQueue.length > 0) {
      const queued = waitingEmitQueue.shift()
      sendPayload(queued)
    }

    boardcast({
      type: 'connect',
      payload: config.socket_session_id,
    })
    boardcast({
      type: 'sid',
      payload: config.socket_session_id,
    })
  }

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (!data) return

      const eventName = data.event || data.type
      if (eventName === 'gateway.connect' || eventName === 'connect') {
        boardcast({
          type: 'connect',
          payload: config.socket_session_id,
        })
        boardcast({
          type: 'sid',
          payload: config.socket_session_id,
        })
        return
      }

      if (eventName === 'gateway.disconnect' || eventName === 'disconnect') {
        boardcast({
          type: 'disconnect',
        })
        return
      }

      if (eventName === 'ack' || eventName === 'ping') {
        return
      }

      const mappedType =
        typeof eventName === 'string'
          ? eventName.replaceAll('.', '_').toUpperCase()
          : eventName

      boardcast({
        type: 'message',
        payload: {
          type: mappedType,
          data: data.payload !== undefined ? data.payload : (data.data ?? {}),
          rawEvent: eventName,
        },
      })
    } catch (err) {
      console.warn('[ws worker] Error parsing ws message:', err, event.data)
    }
  }

  ws.onclose = (event) => {
    console.info('[ws worker] WebSocket closed:', event.code, event.reason)
    stopHeartbeat()
    boardcast({
      type: 'disconnect',
    })
    if (!isExplicitClose) {
      scheduleReconnect()
    }
  }

  ws.onerror = (error) => {
    console.error('[ws worker] WebSocket error:', error)
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (currentConfig && !isExplicitClose) {
      console.info('[ws worker] Attempting auto reconnect...')
      setupWs(currentConfig)
    }
  }, 3000)
}

const preparePort = (port: MessagePort | Window) => {
  port.onmessage = (event) => {
    const { type, payload } = event.data
    console.info('[ws worker] get message from main', event.data)

    switch (type) {
      case 'config': {
        setupWs(payload)
        break
      }
      case 'emit': {
        sendPayload(payload)
        break
      }
      case 'reconnect': {
        if (
          ws &&
          (ws.readyState === WebSocket.OPEN ||
            ws.readyState === WebSocket.CONNECTING)
        ) {
          return
        }
        if (currentConfig) {
          if (reconnectTimer) {
            clearTimeout(reconnectTimer)
            reconnectTimer = null
          }
          setupWs(currentConfig)
        }
        break
      }
      case 'init': {
        port.postMessage({ type: 'ping' })

        if (ws && ws.readyState === WebSocket.OPEN) {
          port.postMessage({
            type: 'connect',
            payload: currentConfig?.socket_session_id,
          })
          port.postMessage({
            type: 'sid',
            payload: currentConfig?.socket_session_id,
          })
        }
        break
      }
      default: {
        console.info('Unknown message type:', type)
      }
    }
  }
}

self.addEventListener('connect', (ev: any) => {
  const event = ev as MessageEvent
  const port = event.ports[0]
  ports.push(port)
  preparePort(port)
  port.start()
})

if (!('SharedWorkerGlobalScope' in self)) {
  ports.push(self as any as MessagePort)
  preparePort(self)
}
