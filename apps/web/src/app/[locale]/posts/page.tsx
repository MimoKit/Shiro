import '~/components/modules/post/PostItem'

import type { Pager } from '@mx-space/api-client'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

import { NormalContainer } from '~/components/layout/container/Normal'
import { PostPagination } from '~/components/modules/post'
import { PostsSettingFab } from '~/components/modules/post/fab/PostsSettingsFab'
import { PostTagsFAB } from '~/components/modules/post/fab/PostTagsFAB'
import { PostItemComposer } from '~/components/modules/post/PostItemComposer'
import { NothingFound } from '~/components/modules/shared/NothingFound'
import { SearchFAB } from '~/components/modules/shared/SearchFAB'
import { BackToTopFAB } from '~/components/ui/fab'
import { OnlyDesktop } from '~/components/ui/viewport'
import { apiClient } from '~/lib/request'
import { definePrerenderPage } from '~/lib/request.server'

import { PostListDataRevaildate } from './data-revalidate'
import { PostLoadMore } from './loader'

interface Props extends LocaleParams {
  page?: string
  size?: string
  sortBy?: string
  orderBy?: string
  view_mode?: string
  lang?: string
}

/**
 * 把任意来源的分页信息归一化成 api-client 的 `Pager` 契约。
 * 兼容三处差异：
 *  - 顶层 `pagination`（api-client 契约） vs v14 的 `meta.pagination`
 *  - `page` → `currentPage`、`total_pages`/`totalPages` → `totalPage`
 *  - 缺失 `hasNextPage` / `hasPrevPage`（由 page/totalPage 推导）
 * 数据层归一化后本函数即为恒等映射；保留它只为页面层不因分页缺失而 500。
 */
const resolvePager = (payload: any): Pager => {
  const source = payload?.pagination ?? payload?.meta?.pagination ?? {}
  const currentPage = Number(source.currentPage ?? source.page ?? 1) || 1
  const totalPage =
    Number(source.totalPage ?? source.totalPages ?? source.total_pages ?? 1) ||
    1
  const size = Number(source.size ?? 10) || 10
  const total = Number(source.total ?? 0) || 0

  return {
    total,
    size,
    currentPage,
    totalPage,
    hasPrevPage: source.hasPrevPage ?? currentPage > 1,
    hasNextPage: source.hasNextPage ?? currentPage < totalPage,
  }
}

export const generateMetadata = async (
  props: NextPageParams<{ locale: string }>,
): Promise<Metadata> => {
  const { locale } = await props.params
  const t = await getTranslations({
    namespace: 'common',
    locale,
  })

  return {
    title: t('page_title_posts'),
  }
}

export default definePrerenderPage<Props>()({
  fetcher: async (params) => {
    const { page, size, orderBy, sortBy, lang, locale } = params || {}
    const currentPage = page ? Number.parseInt(page) : 1
    const currentSize = size ? Number.parseInt(size) : 10

    // 如果指定了 lang=original，不传 lang 参数
    const preferredLang = lang === 'original' ? undefined : lang || locale

    return await apiClient.post.getList(currentPage, currentSize, {
      sortBy: sortBy as any,
      sortOrder: orderBy === 'desc' ? -1 : 1,
      truncate: 310,
      lang: preferredLang,
    })
  },
  Component: async (props) => {
    const { params, fetchedAt } = props
    const { data } = props.data
    // Core v14 把分页放在 `meta.pagination`（{page,size,total,totalPages}），
    // 而 api-client 的 Pager 契约是顶层 `pagination`
    // （{currentPage,totalPage,hasNextPage,hasPrevPage,...}）。
    // 数据层（T2/lib）负责归一化；这里做页面层的容错，避免 pagination 为
    // undefined 时 `pagination.hasNextPage` 直接抛 TypeError 导致 /posts 500。
    const pagination = resolvePager(props.data)
    const { page } = params

    const currentPage = page ? Number.parseInt(page) : 1

    if (!data?.length) {
      return <NothingFound />
    }

    return (
      <NormalContainer>
        <PostListDataRevaildate fetchedAt={fetchedAt} />
        <ul data-fetch-at={fetchedAt}>
          {data.map((item, index) => (
            <PostItemComposer key={item.id} index={index} data={item} />
          ))}
        </ul>

        {currentPage > 1 ? (
          <PostPagination pagination={pagination} />
        ) : (
          pagination.hasNextPage && <PostLoadMore pagination={pagination} />
        )}

        <PostsSettingFab />
        <PostTagsFAB />
        <SearchFAB />
        <OnlyDesktop>
          <BackToTopFAB />
        </OnlyDesktop>
      </NormalContainer>
    )
  },
})
