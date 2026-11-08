import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordErrorMessage } from '../src/auth/passwordErrors';

test('explica los motivos de rechazo de contraseñas de Supabase', () => {
  const characters = Object.assign(new Error('Password should contain more characters'), {
    code: 'weak_password', reasons: ['characters'],
  });
  assert.match(passwordErrorMessage(characters) ?? '', /mayúsculas.*minúsculas.*números.*símbolo/);

  const leaked = Object.assign(new Error('Password is too weak'), {
    code: 'weak_password', reasons: ['pwned'],
  });
  assert.match(passwordErrorMessage(leaked) ?? '', /filtración/);

  const length = Object.assign(new Error('Password should be at least 12 characters'), {
    code: 'weak_password', reasons: ['length'],
  });
  assert.match(passwordErrorMessage(length) ?? '', /al menos 12/);

  assert.equal(passwordErrorMessage(new Error('Invalid login credentials')), null);
});
