import JsonStore from './store'
import type { Friend } from '../shared/types'

const store = new JsonStore<{ friends: Friend[] }>('friends', { friends: [] })

export function getFriends(): Friend[] {
  return store.get('friends') ?? []
}

export function addFriend(friend: Friend): void {
  const list = getFriends()
  if (!list.find(f => f.uuid === friend.uuid)) {
    store.set('friends', [...list, friend])
  }
}

export function removeFriend(uuid: string): void {
  store.set('friends', getFriends().filter(f => f.uuid !== uuid))
}
