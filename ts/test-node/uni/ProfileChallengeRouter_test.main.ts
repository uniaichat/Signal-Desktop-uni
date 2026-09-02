// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { parseProfileChallengeReturn } from '../../../app/uni/profile/ProfileChallengeRouter.main.ts';

describe('ProfileChallengeRouter', () => {
  it('parses the UniChat callback with its Profile destination', () => {
    const callback = new URL('unisgnl://opensignal');
    callback.searchParams.set('windowId', 'profile-1');
    callback.searchParams.set(
      'targeturl',
      'signalcaptcha://signal-hcaptcha.answer/'
    );
    assert.deepEqual(parseProfileChallengeReturn(callback.href), {
      profileId: 'profile-1',
      captcha: 'signal-hcaptcha.answer',
    });
  });

  it('rejects callbacks without a Signal captcha target', () => {
    assert.isUndefined(
      parseProfileChallengeReturn(
        'unisgnl://opensignal?windowId=profile-1&targeturl=https%3A%2F%2Fevil.test'
      )
    );
  });
});
