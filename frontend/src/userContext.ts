import { createContext, useContext } from 'react'
import type { User } from './api'

type UserState = { user: User | null; setUser: (u: User | null) => void }

export const UserContext = createContext<UserState>({ user: null, setUser: () => {} })
export const useUser = () => useContext(UserContext).user
export const useSetUser = () => useContext(UserContext).setUser
