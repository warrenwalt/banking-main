"use server";

import { Client, Account, Databases, Users } from "node-appwrite";
import { cookies } from "next/headers";

/**
 * Creates a new session client with the specified endpoint and project.
 * Retrieves the session from cookies and sets it in the client.
 * Throws an error if no session is found.
 * @returns An object with an 'account' property that allows access to the account related functionalities.
 */
export async function createSessionClient() {
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT!);

  const session = cookies().get("appwrite-session");

  if (!session || !session.value) {
    throw new Error("No session");
  }

  client.setSession(session.value);

  return {
    get account() {
      return new Account(client);
    },
  };
}

/**
 * Asynchronously creates an admin client for interacting with the Appwrite API.
 * The client is configured with the endpoint, project, and key from environment variables.
 * @returns {Object} An object containing account, database, and user properties for interacting with different parts of the API.
 */
export async function createAdminClient() {
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT!)
    .setKey(process.env.NEXT_APPWRITE_KEY!);

  return {
    /**
     * Get an Account object associated with the admin client.
     * @returns {Account} An Account object for interacting with account-related API endpoints.
     */
    get account() {
      return new Account(client);
    },
    /**
     * Get a Databases object associated with the admin client.
     * @returns {Databases} A Databases object for interacting with database-related API endpoints.
     */
    get database() {
      return new Databases(client);
    },
    /**
     * Get a Users object associated with the admin client.
     * @returns {Users} A Users object for interacting with user-related API endpoints.
     */
    get user() {
      return new Users(client);
    },
  };
}
