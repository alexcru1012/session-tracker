import validator from 'validator';
import moment from 'moment-timezone';

export const validateClient = client => {
  const {
    nameAlias,
    emailAlias,
    phone1,
    phone2,
    address1,
    address2,
    notes,
    age,
    dob,
    gender,
  } = client;

  let error = '';

  // Escape required inputs
  const nameAliasInput = nameAlias ? validator.escape(nameAlias) : null;
  // Escape optional inputs
  const emailAliasInput = emailAlias
    ? validator.escape(emailAlias.toString())
    : null;
  const phone1Input = phone1 ? validator.escape(phone1) : null;
  const phone2Input = phone2 ? validator.escape(phone2) : null;
  const address1Input = address1 ? validator.escape(address1) : null;
  const address2Input = address2 ? validator.escape(address2) : null;
  let notesInput = notes ? validator.escape(notes) : '';
  let ageInput = age ? validator.escape(String(age)) : null;
  const dobInput = dob ? moment(dob).format('YYYY-MM-DD') : null;
  const genderInput = gender ? validator.escape(gender) : null;

  // Because someone keeps crashing the server with long notes
  notesInput = notesInput.substring(0, 501);
  ageInput = age ? Math.min(Math.max(parseInt(ageInput, 10), 1), 100) : null;

  // Validate nameAlias length
  if (
    !nameAliasInput ||
    !validator.isLength(nameAliasInput, { min: 2, max: 100 })
  )
    error = 'Invalid name input.';
  // Validate optional emailAlias input
  if (!!emailAliasInput && !validator.isEmail(emailAliasInput))
    error = 'Invalid email input.';

  if (
    !!phone1Input &&
    !validator.isNumeric(phone1Input) &&
    !validator.isMobilePhone(phone1Input)
  )
    error = 'Invalid phone1 input.';

  if (
    !!phone2Input &&
    !validator.isNumeric(phone2Input) &&
    !validator.isMobilePhone(phone2Input)
  )
    error = 'Invalid phone2 input.';

  if (!!notesInput && !validator.isLength(notesInput, { min: 1, max: 500 }))
    error = 'Invalid notes input. (too long)';

  if (!!ageInput && !validator.isNumeric(String(ageInput)))
    error = 'Invalid age input.';

  if (!!genderInput && !validator.isLength(genderInput, { min: 1, max: 100 }))
    error = 'Invalid gender input. (too long)';

  return {
    error,
    nameAliasInput,
    emailAliasInput,
    phone1Input,
    phone2Input,
    address1Input,
    address2Input,
    notesInput,
    ageInput,
    dobInput,
    genderInput,
  };
};

export default {};
