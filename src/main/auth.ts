import { BrowserWindow, safeStorage } from 'electron'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'
import type { MinecraftAccount } from '../shared/types'

const MS_CLIENT_ID = '000000004C12AE6F'
const MS_REDIRECT = 'https://login.live.com/oauth20_desktop.srf'
const XBOX_AUTH_URL = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS_AUTH_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const MC_AUTH_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const MC_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'

export async function loginMicrosoft(
  mainWindow: BrowserWindow,
  _clientId?: string
): Promise<MinecraftAccount> {
  const authUrl =
    `https://login.live.com/oauth20_authorize.srf` +
    `?client_id=${MS_CLIENT_ID}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(MS_REDIRECT)}` +
    `&scope=${encodeURIComponent('XboxLive.signin offline_access')}` +
    `&prompt=select_account`

  const code = await openAuthWindow(mainWindow, authUrl)
  const msTokens = await exchangeCodeForTokens(code)
  return await authenticateWithXbox(msTokens.access_token, msTokens.refresh_token)
}

export async function refreshMicrosoftToken(
  account: MinecraftAccount,
  _clientId?: string
): Promise<MinecraftAccount> {
  if (!account.refreshToken) throw new Error('No refresh token available')

  const decryptedRefresh = safeStorage.isEncryptionAvailable()
    ? safeStorage.decryptString(Buffer.from(account.refreshToken, 'base64'))
    : account.refreshToken

  const params = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    refresh_token: decryptedRefresh,
    grant_type: 'refresh_token',
    redirect_uri: MS_REDIRECT,
    scope: 'XboxLive.signin offline_access'
  })

  const { data } = await axios.post(
    'https://login.live.com/oauth20_token.srf',
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )

  return authenticateWithXbox(data.access_token, data.refresh_token)
}

export function loginOffline(username: string): MinecraftAccount {
  return {
    id: uuidv4(),
    username,
    uuid: uuidv4().replace(/-/g, ''),
    accessToken: 'offline',
    type: 'offline'
  }
}

function openAuthWindow(mainWindow: BrowserWindow, authUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false

    const win = new BrowserWindow({
      width: 520,
      height: 680,
      parent: mainWindow,
      modal: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    })

    win.loadURL(authUrl)

    function handleUrl(_event: unknown, url: string) {
      if (settled || !url.startsWith(MS_REDIRECT)) return
      settled = true

      const params = new URL(url).searchParams
      const code = params.get('code')
      const errorDesc = params.get('error_description') ?? params.get('error')

      win.destroy()

      if (code) resolve(code)
      else reject(new Error(errorDesc || 'Autenticación cancelada o fallida'))
    }

    win.webContents.on('will-redirect', handleUrl)
    win.webContents.on('will-navigate', handleUrl)
    win.webContents.on('did-navigate', (_e, url) => handleUrl(_e, url))
    win.webContents.on('did-redirect-navigation', (_e, url) => handleUrl(_e, url))

    win.on('closed', () => {
      if (!settled) reject(new Error('Ventana de login cerrada'))
    })
  })
}

async function exchangeCodeForTokens(
  code: string
): Promise<{ access_token: string; refresh_token: string }> {
  const params = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    code,
    grant_type: 'authorization_code',
    redirect_uri: MS_REDIRECT,
    scope: 'XboxLive.signin offline_access'
  })

  const { data } = await axios.post(
    'https://login.live.com/oauth20_token.srf',
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )

  return { access_token: data.access_token, refresh_token: data.refresh_token }
}

async function authenticateWithXbox(
  msAccessToken: string,
  refreshToken?: string
): Promise<MinecraftAccount> {
  console.log('[auth] Step 1: Xbox Live auth...')
  // Xbox Live auth
  const { data: xblData } = await axios.post(
    XBOX_AUTH_URL,
    {
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${msAccessToken}`
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    },
    { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }
  )

  console.log('[auth] Step 1 OK. Step 2: XSTS...')
  const xblToken = xblData.Token
  const xblUhs = xblData.DisplayClaims.xui[0].uhs

  // XSTS token
  let xstsData: { Token: string; XErr?: number }
  try {
    const res = await axios.post(
      XSTS_AUTH_URL,
      {
        Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT'
      },
      { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }
    )
    xstsData = res.data
  } catch (e: unknown) {
    const xerr = (e as { response?: { data?: { XErr?: number } } }).response?.data?.XErr
    if (xerr === 2148916233) throw new Error('Esta cuenta de Microsoft no tiene una cuenta de Xbox. Crea una en xbox.com.')
    if (xerr === 2148916238) throw new Error('Esta cuenta es de un menor de edad. Agrega la cuenta a una familia de Xbox.')
    throw new Error(`Error de Xbox Live (${xerr ?? 'desconocido'}). Asegúrate de tener una cuenta de Xbox vinculada.`)
  }

  console.log('[auth] Step 2 OK. Step 3: MC token...')
  const xstsToken = xstsData.Token

  // Minecraft token
  const { data: mcData } = await axios.post(
    MC_AUTH_URL,
    { identityToken: `XBL3.0 x=${xblUhs};${xstsToken}` },
    { headers: { 'Content-Type': 'application/json' } }
  )

  console.log('[auth] Step 3 OK. Step 4: MC profile...')
  const mcAccessToken: string = mcData.access_token

  // Get profile (confirms the account has Minecraft; fails with 404 if not)
  let profile: { name: string; id: string }
  try {
    const res = await axios.get(MC_PROFILE_URL, {
      headers: { Authorization: `Bearer ${mcAccessToken}` }
    })
    profile = res.data
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } }).response?.status
    if (status === 404) throw new Error('Esta cuenta de Microsoft no tiene Minecraft. Compra el juego en minecraft.net.')
    throw new Error('No se pudo obtener el perfil de Minecraft.')
  }

  const encryptedRefresh =
    refreshToken && safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(refreshToken).toString('base64')
      : refreshToken

  return {
    id: uuidv4(),
    username: profile.name,
    uuid: profile.id,
    accessToken: mcAccessToken,
    type: 'microsoft',
    refreshToken: encryptedRefresh,
    expiresAt: Date.now() + 86_400_000
  }
}

export function isTokenExpired(account: MinecraftAccount): boolean {
  if (account.type === 'offline') return false
  if (!account.expiresAt) return true
  return Date.now() > account.expiresAt - 300_000
}
