// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
import { memo, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { CaptchaDialog } from '../../components/CaptchaDialog.dom.tsx';
import { getIntl } from '../selectors/user.std.ts';
import { isChallengePending } from '../selectors/network.preload.ts';
import { getChallengeURL } from '../../challenge.dom.ts';
import { createLogger } from '../../logging/log.std.ts';

const log = createLogger('CaptchaDialog');

export type SmartCaptchaDialogProps = Readonly<{
  onSkip: () => void;
}>;

export const SmartCaptchaDialog = memo(function SmartCaptchaDialog({
  onSkip,
}: SmartCaptchaDialogProps) {
  const i18n = useSelector(getIntl);
  const isPending = useSelector(isChallengePending);
  const handleContinue = useCallback(async () => {
    let url = getChallengeURL('chat');
    const config = await window.uniIpc?.getConfig?.();
    if (config?.windowId) {
      const challengeUrl = new URL(url);
      challengeUrl.searchParams.set('windowId', String(config.windowId));
      url = `unisignalopen://${encodeURIComponent(challengeUrl.href)}`;
    }
    log.info(`navigating to ${url}`);
    document.location.href = url;
  }, []);
  return (
    <CaptchaDialog
      i18n={i18n}
      isPending={isPending}
      onSkip={onSkip}
      onContinue={handleContinue}
    />
  );
});
