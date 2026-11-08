import { useEffect, useState } from "react";
import { getProfile, Profile } from "../api/profile";

export function useUserProfile(userId: string) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    setIsSuccess(false);
    getProfile(userId)
      .then((data) => {
        setProfile(data);
        setIsSuccess(true);
        setIsLoading(false);
      })
      .catch(() => {
        setIsError(true);
      });
  }, [userId]);

  const retry = () => {
    setIsRetrying(true);
    getProfile(userId).then((data) => {
      setProfile(data);
      setIsRetrying(false);
      setIsSuccess(true);
    });
  };

  return { profile, isLoading, isError, isSuccess, isRetrying, retry };
}
