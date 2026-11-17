import { redirect } from "next/navigation";

/** GST reports now live in the central GST module. */
export default function GstReportsRedirect() {
  redirect("/gst");
}
