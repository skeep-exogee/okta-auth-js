import { useEffect, useState, useRef } from 'react';
import { useHistory } from 'react-router-dom';
import { OktaAuth, IdxStatus, urlParamsToObject } from '@okta/okta-auth-js';
import oidcConfig from './config';
import './App.css';

function createOktaAuthInstance() {
  const { state } = urlParamsToObject(window.location.search);
  return new OktaAuth(Object.assign({}, oidcConfig, {
    state
  }));
}

const oktaAuth = createOktaAuthInstance();

const formMetaMapper = (nextStep) => {
  const { inputs, options } = nextStep;
  return {
    ...nextStep,
    inputs: !options && inputs.map(({ label, name, type, secret, required }) => {
      if (secret) {
        type = 'password';
      } else if (type === 'string') {
        type = 'text';
      }
      return { label, name, type, required };
    }),
    select: options && {
      name: inputs[0].name,
      options
    },
  };
};

export default function App() {
  const history = useHistory();
  const [transaction, setTransaction] = useState(null);
  const [inputValues, setInputValues] = useState({});
  const [authState, setAuthState] = useState(null);

  useEffect(() => {
    const parseFromUrl = async () => {
      try {
        await oktaAuth.idx.handleInteractionCodeRedirect(window.location.href);
        history.push('/');
      } catch (err) {
        console.log(err);
      }
    };

    const updateAuthState = authState => {
      setAuthState(authState)
    };

    oktaAuth.authStateManager.subscribe(updateAuthState);
    oktaAuth.start();

    if(oktaAuth.isLoginRedirect()) {
      return parseFromUrl();
    }
    
    const handleEmailVerifyCallback = async () => {
      const { state, otp } = await oktaAuth.parseEmailVerifyCallback(window.location.search);
      history.push('/');
      if (oktaAuth.idx.canProceed({ state })) {
        const newTransaction = await oktaAuth.idx.proceed({ state, otp });
        setTransaction(newTransaction);
      } else {
        setTransaction({
          status: IdxStatus.FAILURE,
          error: new Error(`Enter the OTP code in the original tab: ${otp}`)
        });
      }
    }

    if (oktaAuth.isEmailVerifyCallback(window.location.search)) {
      return handleEmailVerifyCallback();
    }

    const resumeTransaction = async () => {
      const newTransaction = await oktaAuth.idx.proceed();
      setTransaction(newTransaction);
    }

    if (oktaAuth.idx.canProceed()) {
      resumeTransaction();
    }

  }, [history, setAuthState, setTransaction]);

  const handleChange = ({ target: { name, value } }) => setInputValues({
    ...inputValues,
    [name]: value
  });

  const handleSubmit = async e => {
    e.preventDefault();

    const newTransaction = await oktaAuth.idx.proceed(inputValues);
    console.log('Transaction:', newTransaction);

    setInputValues({});
    if (newTransaction.status === IdxStatus.SUCCESS) {
      oktaAuth.tokenManager.setTokens(newTransaction.tokens);
    } else {
      setTransaction(newTransaction);
    }
  };

  const handleSkip = async () => {
    const newTransaction = await oktaAuth.idx.proceed({ skip: true });
    setTransaction(newTransaction);
  };

  const handleCancel = async () => {
    const newTransaction = await oktaAuth.idx.cancel();
    setTransaction(newTransaction);
  };

  const handleLogoutOut = async () => {
    await oktaAuth.signOut();
  };

  const startIdxFlow = flowMethod => async () => {
    const newTransaction = flowMethod === 'idp' 
      ? await oktaAuth.idx.startTransaction() 
      : await oktaAuth.idx[flowMethod]();
    setTransaction(newTransaction);
  };

  if (!authState) {
    return null;
  }

  if (authState?.idToken) {
    return (
      <>
        <button onClick={handleLogoutOut}>Logout</button>
        <div>
          <h3>ID Token</h3>
          <pre>{JSON.stringify(authState.idToken, undefined, 2)}</pre>
        </div>
      </>
    );
  }

  const topNav = (
    <div>
      <button onClick={startIdxFlow('authenticate')}>Login</button>
      <button onClick={startIdxFlow('recoverPassword')}>Recover Password</button>
      <button onClick={startIdxFlow('register')}>Registration</button>
      <button onClick={startIdxFlow('idp')}>IDP</button>
    </div>
  );
  if (!transaction) {
    // initial page
    return (
      <div>
        {topNav}
      </div>
    );
  }

  const { status, nextStep, error, messages, availableSteps, tokens } = transaction;
  if (tokens) {
    oktaAuth.tokenManager.setTokens(tokens);
    return null;
  }

  const idpMeta = availableSteps?.find(step => step.name === 'redirect-idp');
  if (idpMeta) {
    return (
      <div>
        <div>Type: {idpMeta.type}</div>
        <a href={idpMeta.href}>Login With Google</a>
      </div>
    )
  }

  if (status === IdxStatus.FAILURE) {
    return (<div>{error.message || JSON.stringify(error, null, 4)}</div>);
  }

  if (status === IdxStatus.TERMINAL) {
    return (<div>{JSON.stringify(messages, null, 4)}</div>);
  }

  if (status === IdxStatus.CANCELED) {
    return (
      <>
        <div>Transaction has been canceled!</div>
        <button onClick={() => setTransaction(null)}>Restart</button>
      </>
    );
  }

  const { name, inputs, select, contextualData, canSkip } = formMetaMapper(nextStep);
  const meta = oktaAuth.transactionManager.load();
  return (
    <div>
    {topNav}
    <strong>{meta?.flow || 'default'}</strong>
    <form onSubmit={handleSubmit}>
      <div className="messages">
        { messages && messages.map(message => (<div key={message.message}>{message.message}</div>)) }
      </div>
      <h3 className="title">{name}</h3>
      {inputs && inputs.map(({ label, name, type, required }) => (
        <label key={name}>{label}&nbsp;
          <input 
            name={name} 
            type={type} 
            value={inputValues[name] || ''} 
            required={required} 
            onChange={handleChange} 
          />
          <br/>
        </label>
      ))}
      {select && (
        <select name={select.name} onChange={handleChange}>
          <option value="">---</option>
          {select.options.map(({ label, value }) => (
            <option key={value}  value={value}>{label}</option>
          ))}
        </select>
      )}
      {contextualData && (
        <div>
          <img src={contextualData.qrcode.href} />
          <div>{contextualData.sharedSecret}</div>
        </div>
      )}
      {canSkip && <button type="button" onClick={handleSkip}>Skip</button>}
      <button type="submit">Submit</button>
      <button type="button" onClick={handleCancel}>Cancel</button>
    </form>
    </div>
  );
}
