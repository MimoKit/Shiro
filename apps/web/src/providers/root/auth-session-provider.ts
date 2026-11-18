import { useQuery } from '@tanstack/react-query'
import { nanoid } from 'nanoid'
import { useEffect } from 'react'

import { fetchAppUrl } from '~/atoms'
import { setIsOwnerLogged } from '~/atoms/hooks/owner'
import { setSessionReader } from '~/atoms/hooks/reader'
import type { authClient } from '~/lib/authjs'
import { apiClient } from '~/lib/request'

type AdapterUser = typeof authClient.$Infer.Session
export const AuthSessionProvider: Component = ({ children }) => {
  const { data: session } = useQuery({
    queryKey: ['session'],
    refetchOnMount: 'always',
    queryFn: () =>
      apiClient.proxy.auth.session.get<AdapterUser>({
        params: {
          r: nanoid(),
        },
      }),
  })
  useEffect(() => {
    if (!session) {
      setIsOwnerLogged(false)
      setSessionReader(null)
      return
    }
    // session 已经过管线 A 归一化，不要再套 simpleCamelcaseKeys 二次转换：
    // normalize 明确禁止（会改坏保留下划线的字段与带下划线的 map 键）
    const transformedData = session as any

    setSessionReader(transformedData)
    if (transformedData.role === 'owner') {
      setIsOwnerLogged(true)
      fetchAppUrl()
    }
  }, [session])
  return children
}
