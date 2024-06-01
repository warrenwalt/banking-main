"use server";

import { ID, Query } from "node-appwrite";
import { createAdminClient, createSessionClient } from "../appwrite";
import { cookies } from "next/headers";
import { encryptId, extractCustomerIdFromUrl, parseStringify } from "../utils";
import {
  CountryCode,
  ProcessorTokenCreateRequest,
  ProcessorTokenCreateRequestProcessorEnum,
  Products,
} from "plaid";

import { plaidClient } from "@/lib/plaid";
import { revalidatePath } from "next/cache";
import { addFundingSource, createDwollaCustomer } from "./dwolla.actions";

const {
  APPWRITE_DATABASE_ID: DATABASE_ID,
  APPWRITE_USER_COLLECTION_ID: USER_COLLECTION_ID,
  APPWRITE_BANK_COLLECTION_ID: BANK_COLLECTION_ID,
} = process.env;

/**
 * Retrieves user information from the database based on the provided userId.
 * @param {getUserInfoProps} userId - The unique identifier of the user to retrieve information for.
 * @returns {Promise<any>} The user information retrieved from the database.
 */
export const getUserInfo = async ({ userId }: getUserInfoProps) => {
  try {
    const { database } = await createAdminClient();

    const user = await database.listDocuments(
      DATABASE_ID!,
      USER_COLLECTION_ID!,
      [Query.equal("userId", [userId])],
    );

    return parseStringify(user.documents[0]);
  } catch (error) {
    console.log(error);
  }
};

/**
 * Sign in a user with the provided email and password.
 * @param {Object} signInProps - Object containing email and password for signing in.
 * @param {string} signInProps.email - User's email address.
 * @param {string} signInProps.password - User's password.
 * @returns {Promise<Object>} - A Promise that resolves to the user information after successful sign-in.
 */
export const signIn = async ({ email, password }: signInProps) => {
  try {
    // Create an admin client and retrieve the account information
    const { account } = await createAdminClient();

    // Create a session using the provided email and password
    const session = await account.createEmailPasswordSession(email, password);

    // Set the session cookie with specific options
    cookies().set("appwrite-session", session.secret, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: true,
    });

    // Retrieve user information using the session's userId
    const user = await getUserInfo({ userId: session.userId });

    // Return the user information after converting it to a string
    return parseStringify(user);
  } catch (error) {
    // Log any errors that occur during the sign-in process
    console.error("Error", error);
  }
};

/**
 * Creates a new user account with the provided user data and password.
 * Also creates a Dwolla customer for the user and sets up a session.
 * @param {SignUpParams} userData - The user data including email, first name, last name, and other details.
 * @returns {Promise<string>} A stringified version of the newly created user.
 */
export const signUp = async ({ password, ...userData }: SignUpParams) => {
  const { email, firstName, lastName } = userData;

  let newUserAccount;

  try {
    const { account, database } = await createAdminClient();

    newUserAccount = await account.create(
      ID.unique(),
      email,
      password,
      `${firstName} ${lastName}`,
    );

    if (!newUserAccount) throw new Error("Error creating user");

    const dwollaCustomerUrl = await createDwollaCustomer({
      ...userData,
      type: "personal",
    });

    if (!dwollaCustomerUrl) throw new Error("Error creating Dwolla customer");

    const dwollaCustomerId = extractCustomerIdFromUrl(dwollaCustomerUrl);

    const newUser = await database.createDocument(
      DATABASE_ID!,
      USER_COLLECTION_ID!,
      ID.unique(),
      {
        ...userData,
        userId: newUserAccount.$id,
        dwollaCustomerId,
        dwollaCustomerUrl,
      },
    );

    const session = await account.createEmailPasswordSession(email, password);

    cookies().set("appwrite-session", session.secret, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: true,
    });

    return parseStringify(newUser);
  } catch (error) {
    console.error("Error", error);
  }
};

/**
 * Asynchronously retrieves the logged-in user information.
 * This function first creates a session client to get the account information,
 * then fetches the user information based on the account ID.
 * @returns {Promise<Object|null>} A promise that resolves with the user information object or null if an error occurs.
 */
export async function getLoggedInUser() {
  try {
    const { account } = await createSessionClient();
    const result = await account.get();

    const user = await getUserInfo({ userId: result.$id });

    return parseStringify(user);
  } catch (error) {
    console.log(error);
    return null;
  }
}

/**
 * Logs out the current account by deleting the session.
 * @returns {Promise<void>} A Promise that resolves once the account is successfully logged out.
 */
export const logoutAccount = async () => {
  try {
    const { account } = await createSessionClient();

    cookies().delete("appwrite-session");

    await account.deleteSession("current");
  } catch (error) {
    return null;
  }
};

/**
 * Creates a link token for the given user using Plaid API.
 * @param user - The user object for which the link token is being created.
 * @returns A Promise that resolves to an object containing the link token.
 */
export const createLinkToken = async (user: User) => {
  try {
    const tokenParams = {
      user: {
        client_user_id: user.$id,
      },
      client_name: `${user.firstName} ${user.lastName}`,
      products: ["auth"] as Products[],
      language: "en",
      country_codes: ["US"] as CountryCode[],
    };

    const response = await plaidClient.linkTokenCreate(tokenParams);

    return parseStringify({ linkToken: response.data.link_token });
  } catch (error) {
    console.log(error);
  }
};

/**
 * Creates a new bank account for a user in the database.
 * @param {createBankAccountProps} params - Object containing user and bank account details.
 * @returns {Promise<string>} A Promise that resolves to a stringified representation of the created bank account.
 */
export const createBankAccount = async ({
  userId,
  bankId,
  accountId,
  accessToken,
  fundingSourceUrl,
  shareableId,
}: createBankAccountProps) => {
  try {
    const { database } = await createAdminClient();

    const bankAccount = await database.createDocument(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      ID.unique(),
      {
        userId,
        bankId,
        accountId,
        accessToken,
        fundingSourceUrl,
        shareableId,
      },
    );

    return parseStringify(bankAccount);
  } catch (error) {
    console.log(error);
  }
};

/**
 * Exchanges a public token for an access token and item ID, retrieves account information from Plaid,
 * creates a processor token for Dwolla, and creates a funding source URL for the account.
 * Finally, creates a bank account and returns a success message.
 *
 * @param {exchangePublicTokenProps} Object containing publicToken and user information
 * @returns {Promise<string>} A success message indicating the public token exchange is complete
 */
export const exchangePublicToken = async ({
  publicToken,
  user,
}: exchangePublicTokenProps) => {
  try {
    // Exchange public token for access token and item ID
    const response = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });

    const accessToken = response.data.access_token;
    const itemId = response.data.item_id;

    // Get account information from Plaid using the access token
    const accountsResponse = await plaidClient.accountsGet({
      access_token: accessToken,
    });

    const accountData = accountsResponse.data.accounts[0];

    // Create a processor token for Dwolla using the access token and account ID
    const request: ProcessorTokenCreateRequest = {
      access_token: accessToken,
      account_id: accountData.account_id,
      processor: "dwolla" as ProcessorTokenCreateRequestProcessorEnum,
    };

    const processorTokenResponse = await plaidClient.processorTokenCreate(
      request,
    );
    const processorToken = processorTokenResponse.data.processor_token;

    // Create a funding source URL for the account using the Dwolla customer ID, processor token, and bank name
    const fundingSourceUrl = await addFundingSource({
      dwollaCustomerId: user.dwollaCustomerId,
      processorToken,
      bankName: accountData.name,
    });

    // If the funding source URL is not created, throw an error
    if (!fundingSourceUrl) throw Error;

    // Create a bank account using the user ID, item ID, account ID, access token, funding source URL, and shareableId ID
    await createBankAccount({
      userId: user.$id,
      bankId: itemId,
      accountId: accountData.account_id,
      accessToken,
      fundingSourceUrl,
      shareableId: encryptId(accountData.account_id),
    });

    // Revalidate the path to reflect the changes
    revalidatePath("/");

    // Return a success message
    return parseStringify({
      publicTokenExchange: "complete",
    });
  } catch (error) {
    console.error("An error occurred while creating exchanging token:", error);
  }
};

/**
 * Retrieves a list of banks associated with a specific user from the database.
 * @param {getBanksProps} userId - The ID of the user for whom to retrieve the banks.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of bank objects.
 */
export const getBanks = async ({ userId }: getBanksProps) => {
  try {
    const { database } = await createAdminClient();

    const banks = await database.listDocuments(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      [Query.equal("userId", [userId])],
    );

    return parseStringify(banks.documents);
  } catch (error) {
    console.log(error);
  }
};

export const getBank = async ({ documentId }: getBankProps) => {
  try {
    const { database } = await createAdminClient();

    const bank = await database.listDocuments(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      [Query.equal("$id", [documentId])],
    );

    return parseStringify(bank.documents[0]);
  } catch (error) {
    console.log(error);
  }
};

/**
 * Retrieves bank information by account ID from the database.
 * @param {getBankByAccountIdProps} accountId - The account ID to search for.
 * @returns {Promise<Object | null>} The bank information if found, otherwise null.
 */
export const getBankByAccountId = async ({
  accountId,
}: getBankByAccountIdProps) => {
  try {
    const { database } = await createAdminClient();

    const bank = await database.listDocuments(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      [Query.equal("accountId", [accountId])],
    );

    if (bank.total !== 1) return null;

    return parseStringify(bank.documents[0]);
  } catch (error) {
    console.log(error);
  }
};
