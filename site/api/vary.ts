import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleSeamstressRequest } from '../src/server/fuse'

export const maxDuration = 60

export default function vary(req: IncomingMessage, res: ServerResponse) {
  req.url = '/api/vary'
  return handleSeamstressRequest(req, res, process.cwd(), process.env.VERCEL ? 'production' : 'development')
}
