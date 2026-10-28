import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { OtpInput } from './otp-input';

/** The code as six boxes over one input (phase U, stage M2, decision D104). */
describe('OtpInput', () => {
  it('is one field named by its label, taking digits only, six at most', async () => {
    const onChange = jest.fn();
    await render(<OtpInput label="Code sent by SMS" value="" onChange={onChange} />);
    const field = screen.getByLabelText('Code sent by SMS');
    expect(field).toHaveProp('autoComplete', 'sms-otp');
    expect(field).toHaveProp('textContentType', 'oneTimeCode');
    await fireEvent.changeText(field, '12 34-5678');
    expect(onChange).toHaveBeenLastCalledWith('123456');
  });

  it('draws each digit in its box, and submits only a whole code', async () => {
    const onSubmit = jest.fn();
    const { rerender } = await render(
      <OtpInput label="Code" value="482" onChange={() => undefined} onSubmit={onSubmit} />,
    );
    // The boxes are hidden from screen readers, which meet the field and its value instead.
    expect(screen.getByText('4', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByText('2', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByText('4')).toBeNull();
    await fireEvent(screen.getByLabelText('Code'), 'submitEditing');
    expect(onSubmit).not.toHaveBeenCalled();
    await rerender(
      <OtpInput label="Code" value="482913" onChange={() => undefined} onSubmit={onSubmit} />,
    );
    await fireEvent(screen.getByLabelText('Code'), 'submitEditing');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('says what went wrong under the boxes, in place of the help', async () => {
    await render(
      <OtpInput
        label="Code"
        value="000000"
        onChange={() => undefined}
        help="The code fills itself in."
        error="That code is not right."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('That code is not right.');
    expect(screen.queryByText('The code fills itself in.')).toBeNull();
    expect(screen.getByLabelText('Code')).toHaveProp('aria-invalid', true);
  });
});
