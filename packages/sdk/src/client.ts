import { HttpClient } from './http.js'
import { AgentsAPI } from './agents.js'
import { UsageAPI } from './usage.js'
import { AuthAPI } from './auth.js'
import { getApiUrl, getAuth } from './config.js'
import { AuthenticationError } from './errors.js'
import type { CastariClientOptions } from './types.js'

/**
 * Main client for interacting with the Castari API
 *
 * @example
 * ```typescript
 * import { CastariClient } from '@castari/sdk';
 *
 * // Uses credentials from ~/.castari or CASTARI_API_KEY env var
 * const client = new CastariClient();
 *
 * // Or provide credentials explicitly
 * const client = new CastariClient({ apiKey: 'cap_xxxxx' });
 *
 * // List agents
 * const agents = await client.agents.list();
 *
 * // Deploy an agent
 * await client.agents.deploy('my-agent');
 *
 * // Invoke an agent
 * const result = await client.agents.invoke('my-agent', { prompt: 'Hello!' });
 * ```
 */
export class CastariClient {
  private httpClient: HttpClient
  private authInitialized = false
  private urlInitialized = false
  private initPromise: Promise<void> | null = null

  /** API for managing agents */
  readonly agents: AgentsAPI

  /** API for accessing usage statistics */
  readonly usage: UsageAPI

  /** API for authentication operations */
  readonly auth: AuthAPI

  /**
   * Create a new Castari client
   * @param options - Client configuration options
   */
  constructor(private options: CastariClientOptions = {}) {
    // Create HTTP client with provided or default base URL
    this.httpClient = new HttpClient({
      baseUrl: options.baseUrl || 'https://api.castari.com',
    })

    // Set auth if provided directly
    if (options.apiKey) {
      this.httpClient.setAuth('api_key', options.apiKey)
      this.authInitialized = true
    } else if (options.token) {
      this.httpClient.setAuth('token', options.token)
      this.authInitialized = true
    }

    // Mark URL as initialized if provided directly
    if (options.baseUrl) {
      this.urlInitialized = true
    }

    // Initialize API classes
    this.agents = new AgentsAPI(this.httpClient)
    this.usage = new UsageAPI(this.httpClient)
    this.auth = new AuthAPI(this.httpClient)
  }

  /**
   * Initialize the client by loading credentials and URL from config
   * This is called automatically before the first API request
   */
  private async initialize(): Promise<void> {
    // Return early only if both auth and URL are already initialized
    if (this.authInitialized && this.urlInitialized) return

    // If already initializing, wait for it
    if (this.initPromise) {
      await this.initPromise
      return
    }

    this.initPromise = this.doInitialize()
    await this.initPromise
  }

  private async doInitialize(): Promise<void> {
    // Load base URL from config/env if not provided directly
    if (!this.urlInitialized) {
      const apiUrl = await getApiUrl()
      this.httpClient.setBaseUrl(apiUrl)
      this.urlInitialized = true
    }

    // Load auth from config if not provided directly
    if (!this.authInitialized) {
      const auth = await getAuth()
      if (auth) {
        this.httpClient.setAuth(auth.type, auth.value)
      }
      this.authInitialized = true
    }
  }

  /**
   * Ensure the client is initialized before making requests
   * @throws AuthenticationError if no credentials are available
   */
  async ensureAuthenticated(): Promise<void> {
    await this.initialize()

    const auth = await getAuth()
    if (!auth && !this.options.apiKey && !this.options.token) {
      throw new AuthenticationError()
    }
  }
}
