import type { FC } from 'react'
import { useEffect, useId, useState } from 'react'

import { useIsDark } from '~/hooks/common/use-is-dark'

import { BlockLoading } from './BlockLoading'

export const Mermaid: FC<{
  content: string
}> = (props) => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [svg, setSvg] = useState('')
  const [width, setWidth] = useState<number>()

  const isDark = useIsDark()

  useEffect(() => {
    import('mermaid').then(async (mo) => {
      const mermaid = mo.default

      mermaid.initialize({
        theme: isDark ? 'dark' : 'default',
      })
    })
  }, [isDark])

  const id = useId().split(':').join('')

  useEffect(() => {
    if (!props.content) {
      return
    }
    setError('')
    setLoading(true)

    let isCanceled = false

    import('mermaid').then(async (mo) => {
      const mermaid = mo.default

      let result
      try {
        result = await mermaid.render(`mermaid-${id}`, props.content)
      } catch (error) {
        document.getElementById(`dmermaid-${id}`)?.remove()
        if (error instanceof Error) {
          setError(error.message)
        }
        setSvg('')
        setWidth(undefined)
      }

      if (isCanceled) return

      if (result) {
        setSvg(result.svg)

        const match = result.svg.match(/viewBox="[^"]*\s([\d.]+)\s([\d.]+)"/)
        if (match?.[1]) {
          setWidth(Number.parseInt(match[1]))
        }
        setError('')
      }
      setLoading(false)
      return () => {
        isCanceled = true
      }
    })
  }, [id, props.content])
  return loading ? (
    <BlockLoading>Mermaid Loading...</BlockLoading>
  ) : svg ? (
    // 直接内联渲染 mermaid 产出的 SVG。旧实现把 SVG 编码成 base64 data URI
    // 再塞进 FixedZoomedImage 的图片管线（带宽高 → 走 next/image），
    // data URI SVG 在该管线里必然加载失败并被锁死成「加载失败」。
    <div
      className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      style={{ maxWidth: width ? `${width}px` : undefined }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  ) : (
    <div className="flex min-h-[50px] items-center justify-center rounded-lg bg-red-100 text-sm">
      {error || 'Error'}
    </div>
  )
}
