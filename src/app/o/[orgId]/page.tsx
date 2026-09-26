"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function OrgIndex() {
  const params = useParams<{ orgId: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/o/${params.orgId}/c/general`);
  }, [params.orgId, router]);
  return null;
}
