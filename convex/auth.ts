import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { internalMutation } from "./_generated/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = params.email as string;
        const name = (params.name as string | undefined) || email.split("@")[0];
        return { email, name };
      },
    }),
  ],
});

/** One-off data repair: backfills the display name for users who signed up before the profile() callback was added. Not exposed in the UI. */
export const backfillMissingNames = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    for (const user of users) {
      if (!user.name && user.email) {
        await ctx.db.patch(user._id, { name: user.email.split("@")[0] });
      }
    }
  },
});
