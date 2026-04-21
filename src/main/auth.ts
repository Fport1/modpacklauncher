import { BrowserWindow, safeStorage } from 'electron'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'
import type { MinecraftAccount } from '../shared/types'

const MS_REDIRECT = 'https://login.microsoftonline.com/common/oauth2/nativeclient'
const XBOX_AUTH_URL = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS_AUTH_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const MC_AUTH_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const MC_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'
const MC_STORE_URL = 'https://api.minecraftservices.com/entitlements/mcstore'

export async function loginMicrosoft(
  mainWindow: BrowserWindow,
  clientId: string
): Promise<MinecraftAccount> {
  if (!clientId) throw new Error('Azure Client ID not configured. Set it in Settings.')

  const authUrl =
    `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize` +
    `?client_id=${clientId}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(MS_REDIRECT)}` +
    `&scope=${encodeURIComponent('XboxLive.signin offline_access')}` +
    `&prompt=select_account`

  const code = await openAuthWindow(mainWindow, authUrl)
  const msTokens = await exchangeCodeForTokens(code, clientId)
  return await authenticateWithXbox(msTokens.access_token, msTokens.refresh_token)
}

export async function refreshMicrosoftToken(
  account: MinecraftAccount,
  clientId: string
): Promise<MinecraftAccount> {
  if (!account.refreshToken) throw new Error('No refresh token available')

  const decryptedRefresh = safeStorage.isEncryptionAvailable()
    ? safeStorage.decryptString(Buffer.from(account.refreshToken, 'base64'))
    : account.refreshToken

  const params = new URLSearchParams({
    client_id: clientId,
    refresh_token: decryptedRefresh,
    grant_type: 'refresh_token',
    scope: 'XboxLive.signin offline_access'
  })

  const { data } = await axios.post(
    'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
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
      const error = params.get('error_description')

      win.destroy()

      if (code) resolve(code)
      else reject(new Error(error || 'Authentication failed'))
    }

    win.webContents.on('will-redirect', handleUrl)
    win.webContents.on('will-navigate', handleUrl)

    win.on('closed', () => {
      if (!settled) reject(new Error('Authentication window closed'))
    })
  })
}

async function exchangeCodeForTokens(
  code: string,
  clientId: string
): Promise<{ access_token: string; refresh_token: string }> {
  const params = new URLSearchParams({
    client_id: clientId,
    code,
    grant_type: 'authorization_code',
    redirect_uri: MS_REDIRECT,
    scope: 'XboxLive.signin offline_access'
  })

  const { data } = await axios.post(
    'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )

  return { access_token: data.access_token, refresh_token: data.refresh_token }
}

async function authenticateWithXbox(
  msAccessToken: string,
  refreshToken?: string
): Promise<MinecraftAccount> {
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

  const xblToken = xblData.Token
  const xblUhs = xblData.DisplayClaims.xui[0].uhs

  // XSTS token
  const { data: xstsData } = await axios.post(
    XSTS_AUTH_URL,
    {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    },
    { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }
  )

  const xstsToken = xstsData.Token

  // Minecraft token
  const { data: mcData } = await axios.post(
    MC_AUTH_URL,
    { identityToken: `XBL3.0 x=${xblUhs};${xstsToken}` },
    { headers: { 'Content-Type': 'application/json' } }
  )

  const mcAccessToken: string = mcData.access_token

  // Check ownership
  const { data: storeData } = await axios.get(MC_STORE_URL, {
    headers: { Authorization: `Bearer ${mcAccessToken}` }
  })

  const ownsGame = storeData.items?.some(
    (i: { name: string }) => i.name === 'game_minecraft' || i.name === 'product_minecraft'
  )
  if (!ownsGame) throw new Error('This Microsoft account does not own Minecraft.')

  // Get profile
  const { data: profile } = await axios.get(MC_PROFILE_URL, {
    headers: { Authorization: `Bearer ${mcAccessToken}` }
  })

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
