import {
  intArg,
  mutationType,
  stringArg,
  booleanArg,
  FieldResolver,
  nonNull,
  list,
} from 'nexus'
import { string, object, array, date } from 'yup'
import { compare, hash } from 'bcryptjs'
import { sign } from 'jsonwebtoken'
import {
  APP_SECRET,
  getUserId,
  getServerInfo,
  getVersionQuery,
  getTagsQuery,
  getMciToken,
  issueTokens,
  getMciProfile,
  getDates,
  verifyRefreshToken,
  deleteTokens,
} from './utils'
import { MaybePromise } from 'nexus/dist/core'
let cookie = require('cookie')

const validationSchema = {
  title: object().shape({
    title: string()
      .min(10, 'Title must be at least 10 characters long.')
      .max(280, 'Title must be less than 280 characters long.'),
  }),
  tags: object().shape({
    tags: array().min(1, 'You need to specify at least one tag to add.'),
  }),
  removeTag: object().shape({
    tags: array().min(1, 'You need to specify at least one tag to remove.'),
  }),
  cover: object().shape({
    cover: string()
      .url('Cover needs to be an url.')
      .matches(/[/.](gif|jpg|jpeg|tiff|png)$/, 'Cover needs to be an image.'),
  }),
  content: object().shape({
    content: string()
      .min(280, 'Content must be at least 280 characters long.')
      .max(10000, 'Content must be less than 10000 characters long.'),
  }),
}

export const Mutation = mutationType({
  definition(t) {
    t.field('oAuthLogin', {
      type: 'AuthPayload',
      args: {
        code: nonNull(stringArg()),
      },
      resolve: async (_parent, { code }, ctx): Promise<any> => {
        let token
        try {
          token = await getMciToken(code, ctx)
        } catch (error) {
          return error
        }

        let userProfile
        try {
          userProfile = await getMciProfile(token.access_token)
        } catch (error) {
          return error
        }

        const user = await ctx.prisma.user.upsert({
          where: { id: userProfile.id },
          create: {
            id: userProfile.id,
            username: userProfile.name,
            photoUrl: userProfile.photoUrl,
            email: userProfile.email,
            role: 'user',
            posts: userProfile.posts,
          },
          update: {
            username: userProfile.name,
            photoUrl: userProfile.photoUrl,
            email: userProfile.email,
            posts: userProfile.posts,
          },
        })

        await issueTokens(ctx, user)

        return {
          user,
        }
      },
    })

    t.field('refresh', {
      type: 'AuthPayload',
      resolve: async (_parent, args, ctx): Promise<any> => {
        let userId
        try {
          userId = verifyRefreshToken(ctx)
        } catch (err) {
          return new Error(err)
        }

        const user = await ctx.prisma.user.findUnique({
          where: { id: Number(userId) },
        })

        if (user) {
          await issueTokens(ctx, user)
        } else {
          return new Error('Could not refresh token.')
        }

        return {
          user,
        }
      },
    })

    t.field('logout', {
      type: 'Outcome',
      resolve: async (_parent, args, ctx): Promise<any> => {
        await deleteTokens(ctx)
        return {
          outcome: "You've been logged out.",
        }
      },
    })

    t.field('updateRole', {
      type: 'UserPayload',
      args: {
        id: nonNull(intArg()),
        role: nonNull(stringArg()),
      },
      resolve: async (parent, { id, role }, ctx): Promise<any> => {
        const user = await ctx.prisma.user.update({
          where: { id: id },
          data: {
            role,
          },
        })
        return {
          user,
        }
      },
    })

    t.field('updateBan', {
      type: 'UserPayload',
      args: {
        id: nonNull(intArg()),
        banned: nonNull(booleanArg()),
      },
      resolve: async (parent, { banned, id }, ctx): Promise<any> => {
        const user = await ctx.prisma.user.update({
          where: { id: id },
          data: {
            banned,
          },
        })
        return {
          user,
        }
      },
    })

    t.field('updateTitle', {
      type: 'Server',
      args: {
        id: nonNull(intArg()),
        title: nonNull(stringArg()),
      },
      resolve: async (parent, { title, id }, ctx): Promise<any> => {
        try {
          await validationSchema.title.validate({ title })
        } catch (e) {
          return new Error(e.errors[0])
        }

        const server = await ctx.prisma.server.update({
          where: { id: id },
          data: {
            title,
          },
        })
        return server
      },
    })

    t.field('updateContent', {
      type: 'Server',
      args: {
        id: nonNull(intArg()),
        content: nonNull(stringArg()),
      },
      resolve: async (parent, { content, id }, ctx): Promise<any> => {
        try {
          await validationSchema.content.validate({ content })
        } catch (e) {
          return new Error(e.errors[0])
        }

        const server = await ctx.prisma.server.update({
          where: { id: id },
          data: {
            content,
          },
        })
        return { server }
      },
    })

    t.field('addTag', {
      type: 'Server',
      args: {
        id: nonNull(intArg()),
        tags: nonNull(list(nonNull('String'))),
      },
      resolve: async (parent, { id, tags }, ctx): Promise<any> => {
        try {
          await validationSchema.tags.validate({ tags })
        } catch (e) {
          return new Error(e.errors[0])
        }

        const tagObjects = await getTagsQuery(ctx, tags)

        const server = await ctx.prisma.server.update({
          where: { id: id },
          data: {
            tags: tagObjects,
          },
        })
        return { server }
      },
    })

    t.field('removeTag', {
      type: 'Server',
      args: {
        id: nonNull(intArg()),
        tag: nonNull(stringArg()),
      },
      resolve: async (parent, { id, tag }, ctx): Promise<any> => {
        const server = await ctx.prisma.server.update({
          where: { id: id },
          data: {
            tags: { disconnect: [{ tagName: tag }] },
          },
        })
        return { server }
      },
    })

    t.field('updateCover', {
      type: 'Server',
      args: {
        id: nonNull(intArg()),
        cover: nonNull(stringArg()),
      },
      resolve: async (parent, { id, cover }, ctx): Promise<any> => {
        try {
          await validationSchema.cover.validate({ cover })
        } catch (e) {
          return new Error(e.errors[0])
        }

        const server = await ctx.prisma.server.update({
          where: { id: id },
          data: {
            cover,
          },
        })
        return { server }
      },
    })

    t.field('updateIp', {
      type: 'Server',
      args: {
        id: nonNull(intArg()),
        ip: nonNull(stringArg()),
      },
      resolve: async (parent, { id, ip }, ctx) => {
        let serverInfo
        // Fetch server info
        try {
          serverInfo = await getServerInfo(ip, ctx)
        } catch (error) {
          return error
        }

        const server = await ctx.prisma.server.update({
          where: { id: id },
          data: {
            ip,
          },
        })
        return { server }
      },
    })

    t.field('updateRemoteInfo', {
      type: 'Server',
      args: {
        id: nonNull(intArg()),
        ip: nonNull(stringArg()),
      },
      resolve: async (parent, { id, ip }, ctx) => {
        let serverInfo
        // Fetch server info
        try {
          serverInfo = await getServerInfo(ip, ctx)
        } catch (error) {
          return error
        }

        // return create or connect version
        const versionQuery = await getVersionQuery(ctx, serverInfo.version)
        console.log('versionQuery', versionQuery)

        const server = await ctx.prisma.server.update({
          where: { id: id },
          data: {
            version: versionQuery,
            lastUpdated: new Date(),
            slots: serverInfo.players.max,
          },
        })
        return server
      },
    })

    t.field('createServer', {
      type: 'Server',
      args: {
        title: nonNull(stringArg()),
        content: stringArg(),
        cover: stringArg(),
        tags: nonNull(list(nonNull('String'))),
        ip: nonNull(stringArg()),
      },
      resolve: async (
        parent,
        { title, content, cover, tags, ip },
        ctx,
      ): Promise<any> => {
        const userId = getUserId(ctx)

        try {
          await validationSchema.title.validate({ title })
          await validationSchema.content.validate({ content })
          await validationSchema.cover.validate({ cover })
          await validationSchema.tags.validate({ tags })
        } catch (e) {
          return new Error(e.errors[0])
        }

        const tagObjects = await getTagsQuery(ctx, tags)

        if (!userId) return new Error('Could not authenticate user.')

        // Fetch server info
        let serverInfo = await getServerInfo(ip, ctx)
        if (!serverInfo.online) return new Error('Could not find server info.')

        // return create or connect version
        const versionQuery = await getVersionQuery(ctx, serverInfo.version)
        const server = await ctx.prisma.server.create({
          data: {
            title,
            content,
            cover,
            ip: ip,
            version: versionQuery,
            slots: serverInfo.players.max,
            tags: tagObjects,
            published: true,
            author: { connect: { id: Number(userId) } },
          },
        })
        return server
      },
    })

    t.field('updateServer', {
      type: 'Server',
      args: {
        id: nonNull(intArg()),
        title: nonNull(stringArg()),
        content: stringArg(),
        cover: stringArg(),
        tags: nonNull(list(nonNull('String'))),
        ip: nonNull(stringArg()),
      },
      resolve: async (
        parent,
        { id, title, content, cover, tags, ip },
        ctx,
      ): Promise<any> => {
        const userId = getUserId(ctx)

        try {
          await validationSchema.title.validate({ title })
          await validationSchema.content.validate({ content })
          await validationSchema.cover.validate({ cover })
          await validationSchema.tags.validate({ tags })
        } catch (e) {
          return new Error(e.errors[0])
        }

        const tagObjects = await getTagsQuery(ctx, tags)

        if (!userId) return new Error('Could not authenticate user.')

        // Fetch server info
        let serverInfo = await getServerInfo(ip, ctx)
        if (!serverInfo.online) return new Error('Could not find server info.')

        // return create or connect version
        const versionQuery = await getVersionQuery(ctx, serverInfo.version)
        const server = await ctx.prisma.server.update({
          where: { id },
          data: {
            title,
            content,
            cover,
            ip: ip,
            version: versionQuery,
            slots: serverInfo.players.max,
            tags: tagObjects,
          },
        })
        return server
      },
    })

    t.field('deleteServer', {
      type: 'Server',
      args: { id: nonNull(intArg()) },
      resolve: async (parent, { id }, ctx): Promise<any> => {
        const server = ctx.prisma.server.update({
          where: {
            id,
          },
          data: {
            published: false,
          },
        })
        return server
      },
    })

    t.field('publishServer', {
      type: 'Server',
      args: { id: nonNull(intArg()) },
      resolve: async (parent, { id }, ctx): Promise<any> => {
        const server = ctx.prisma.server.update({
          where: {
            id,
          },
          data: {
            published: true,
          },
        })
        return server
      },
    })

    t.field('vote', {
      type: 'Outcome',
      args: { id: nonNull(intArg()) },
      resolve: async (parent, { id }, ctx): Promise<any> => {
        const userId = getUserId(ctx)
        const [d, f] = getDates(new Date().toISOString())

        const vote = await ctx.prisma
          .$executeRaw`INSERT INTO "Vote" ("authorId", "serverId")
          SELECT ${userId}, ${id}
          WHERE NOT EXISTS (
              SELECT id
              FROM "Vote" as v
              WHERE
                  v."serverId" = ${id} AND
                  v."createdAt" >= ${d} AND
                  v."createdAt" < ${f} AND
                  v."authorId" = ${userId});
          `

        if (vote) {
          return {
            outcome: 'Your vote was added.',
          }
        } else {
          return new Error('You have already voted for this server this month.')
        }
      },
    })

    t.field('resetVotes', {
      type: 'Server',
      args: { id: nonNull(intArg()) },
      resolve: async (parent, { id }, ctx): Promise<any> => {
        const vote = await ctx.prisma.vote.deleteMany({
          where: { serverId: id },
        })
        return ctx.prisma.server.findUnique({
          where: {
            id: Number(id),
          },
        })
      },
    })
  },
})
